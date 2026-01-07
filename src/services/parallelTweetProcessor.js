// src/services/parallelTweetProcessor.js
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { Semaphore } from '../utils/semaphore.js';
import {
  RateLimitError,
  SessionExpiredError,
  PageCrashedError,
  isRetryableError
} from '../utils/errors.js';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Coordinates parallel tweet processing across multiple browser pages.
 */
class ParallelTweetProcessor {
  /**
   * Creates a new ParallelTweetProcessor.
   * @param {import('./pagePoolManager.js').default} pagePool - The page pool manager
   * @param {Object} options - Processing options
   */
  constructor(pagePool, options = {}) {
    this.pagePool = pagePool;
    this.maxWorkers = options.maxWorkers || config.parallelProcessing.tabCount || 3;
    this.staggerDelay = options.staggerDelay || config.parallelProcessing.staggerDelay || 2000;
    this.maxRetries = options.maxRetries || config.parallelProcessing.maxRetriesPerTweet || 3;
    this.rateLimitBackoff = options.rateLimitBackoff || config.parallelProcessing.rateLimitBackoff || 60000;

    // Global rate limiting across all workers
    this.globalRateLimiter = {
      lastGlobalAction: 0,
      minGlobalDelay: this.staggerDelay,
    };

    // Backoff state
    this.globalBackoffUntil = 0;

    // Processing state
    this.tweetQueue = [];
    this.queueIndex = 0;
    this.queueLock = new Semaphore(1);
    this.isProcessing = false;
    this.shouldStop = false;

    // Results tracking
    this.processedCount = 0;
    this.failedCount = 0;
    this.results = [];
  }

  /**
   * Processes all tweets in parallel using the worker pool.
   * @param {Array<string>} tweetUrls - Array of tweet URLs to process
   * @param {Function} processFn - Function to call for each tweet (page, url) => result
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  async processAll(tweetUrls, processFn, options = {}) {
    if (this.isProcessing) {
      throw new Error('Already processing tweets');
    }

    this.isProcessing = true;
    this.shouldStop = false;
    this.tweetQueue = [...tweetUrls];
    this.queueIndex = 0;
    this.processedCount = 0;
    this.failedCount = 0;
    this.results = [];

    const onProgress = options.onProgress || (() => {});
    const onTweetComplete = options.onTweetComplete || (() => {});

    logger.info(`Starting parallel processing of ${tweetUrls.length} tweets with ${this.maxWorkers} workers`);

    try {
      // Launch workers
      const workers = [];
      for (let i = 0; i < this.maxWorkers; i++) {
        // Stagger worker starts
        if (i > 0) {
          await sleep(this.staggerDelay);
        }
        workers.push(this.worker(i, processFn, onProgress, onTweetComplete));
      }

      // Wait for all workers to complete
      await Promise.all(workers);

      const summary = {
        total: tweetUrls.length,
        processed: this.processedCount,
        failed: this.failedCount,
        results: this.results
      };

      logger.info(`Parallel processing complete: ${this.processedCount} processed, ${this.failedCount} failed`);

      return summary;

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Worker function that processes tweets from the queue.
   * @param {number} workerId - Worker ID for logging
   * @param {Function} processFn - Processing function
   * @param {Function} onProgress - Progress callback
   * @param {Function} onTweetComplete - Tweet complete callback
   */
  async worker(workerId, processFn, onProgress, onTweetComplete) {
    logger.debug(`Worker ${workerId + 1} started`);

    while (!this.shouldStop) {
      // Get next tweet from queue
      const tweet = await this.getNextTweet();
      if (!tweet) {
        logger.debug(`Worker ${workerId + 1}: No more tweets, exiting`);
        break;
      }

      // Check for global backoff
      await this.waitForBackoff();

      // Apply global rate limiting
      await this.applyGlobalStagger(workerId);

      // Acquire a page
      let pageInfo;
      try {
        pageInfo = await this.pagePool.acquirePage();
        if (!pageInfo) {
          // Pool is shutting down
          logger.warn(`Worker ${workerId + 1}: Could not acquire page, exiting`);
          break;
        }
      } catch (error) {
        logger.error(`Worker ${workerId + 1}: Error acquiring page: ${error.message}`);
        // Put tweet back in queue
        await this.requeueTweet(tweet);
        continue;
      }

      const { page, pageId, release } = pageInfo;

      try {
        logger.debug(`Worker ${workerId + 1} (${pageId}): Processing ${tweet.url}`);

        const result = await this.processTweetWithRetry(
          page,
          pageId,
          tweet,
          processFn,
          workerId
        );

        this.results.push(result);

        if (result.success) {
          this.processedCount++;
        } else {
          this.failedCount++;
        }

        onTweetComplete(tweet.url, result);
        onProgress({
          total: this.tweetQueue.length,
          processed: this.processedCount,
          failed: this.failedCount,
          current: tweet.url
        });

      } catch (error) {
        // Handle critical errors
        if (error instanceof SessionExpiredError) {
          logger.error('Session expired - stopping all workers');
          this.shouldStop = true;
          throw error;
        }

        logger.error(`Worker ${workerId + 1}: Error processing tweet: ${error.message}`);
        this.failedCount++;
        this.results.push({
          url: tweet.url,
          success: false,
          error: error.message
        });

      } finally {
        release();
      }
    }

    logger.debug(`Worker ${workerId + 1} finished`);
  }

  /**
   * Gets the next tweet from the queue (thread-safe).
   * @returns {Promise<Object|null>} Next tweet or null if queue is empty
   */
  async getNextTweet() {
    return this.queueLock.withPermit(() => {
      if (this.queueIndex >= this.tweetQueue.length) {
        return null;
      }

      const url = this.tweetQueue[this.queueIndex];
      this.queueIndex++;

      return {
        url,
        index: this.queueIndex,
        total: this.tweetQueue.length
      };
    });
  }

  /**
   * Requeues a tweet that failed to process.
   * @param {Object} tweet - The tweet to requeue
   */
  async requeueTweet(tweet) {
    await this.queueLock.withPermit(() => {
      // Add back to end of queue
      this.tweetQueue.push(tweet.url);
    });
  }

  /**
   * Processes a tweet with retry logic.
   * @param {import('puppeteer').Page} page - Browser page
   * @param {string} pageId - Page identifier
   * @param {Object} tweet - Tweet info
   * @param {Function} processFn - Processing function
   * @param {number} workerId - Worker ID
   * @returns {Promise<Object>} Processing result
   */
  async processTweetWithRetry(page, pageId, tweet, processFn, workerId) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Check if page is still valid
        if (page.isClosed()) {
          throw new PageCrashedError('Page was closed');
        }

        const result = await processFn(page, tweet.url);

        return {
          url: tweet.url,
          success: true,
          data: result,
          attempts: attempt
        };

      } catch (error) {
        lastError = error;
        logger.warn(`Worker ${workerId + 1} (${pageId}): Attempt ${attempt}/${this.maxRetries} failed for ${tweet.url}: ${error.message}`);

        // Handle rate limiting
        if (error instanceof RateLimitError) {
          logger.warn('Rate limit detected - triggering global backoff');
          await this.triggerGlobalBackoff();
          // Don't count this as an attempt
          attempt--;
          continue;
        }

        // Handle page crashes
        if (error instanceof PageCrashedError || page.isClosed()) {
          // The page pool will handle recreation
          throw error;
        }

        // Check if error is retryable
        if (!isRetryableError(error)) {
          break;
        }

        // Exponential backoff for retries
        if (attempt < this.maxRetries) {
          const backoff = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
          logger.debug(`Waiting ${backoff}ms before retry...`);
          await sleep(backoff);
        }
      }
    }

    return {
      url: tweet.url,
      success: false,
      error: lastError?.message || 'Unknown error',
      attempts: this.maxRetries
    };
  }

  /**
   * Applies global rate limiting stagger between workers.
   * @param {number} workerId - Worker ID for initial stagger offset
   */
  async applyGlobalStagger(workerId) {
    const now = Date.now();
    const timeSinceGlobal = now - this.globalRateLimiter.lastGlobalAction;

    if (timeSinceGlobal < this.globalRateLimiter.minGlobalDelay) {
      const wait = this.globalRateLimiter.minGlobalDelay - timeSinceGlobal;
      await sleep(wait);
    }

    this.globalRateLimiter.lastGlobalAction = Date.now();
  }

  /**
   * Triggers a global backoff for all workers.
   */
  async triggerGlobalBackoff() {
    this.globalBackoffUntil = Date.now() + this.rateLimitBackoff;
    logger.warn(`Global backoff activated until ${new Date(this.globalBackoffUntil).toISOString()}`);
  }

  /**
   * Waits for any active global backoff to expire.
   */
  async waitForBackoff() {
    const now = Date.now();
    if (now < this.globalBackoffUntil) {
      const wait = this.globalBackoffUntil - now;
      logger.info(`Waiting ${Math.round(wait / 1000)}s for global backoff to clear...`);
      await sleep(wait);
    }
  }

  /**
   * Stops all workers gracefully.
   */
  stop() {
    logger.info('Stopping parallel processor...');
    this.shouldStop = true;
  }

  /**
   * Gets current processing status.
   * @returns {Object} Status info
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      total: this.tweetQueue.length,
      processed: this.processedCount,
      failed: this.failedCount,
      remaining: this.tweetQueue.length - this.queueIndex,
      poolStatus: this.pagePool.getStatus(),
      isBackingOff: Date.now() < this.globalBackoffUntil
    };
  }
}

export default ParallelTweetProcessor;

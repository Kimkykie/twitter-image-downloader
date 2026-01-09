// src/services/imageService.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import downloadTracker from '../utils/downloadTracker.js';
import { createImageDirectory, ensureDirectoryExists } from '../utils/fileSystem.js';
import { setTimeout as sleep } from 'node:timers/promises'; // For delays
import { accountRepository, tweetRepository, imageRepository } from '../db/index.js';
import progressTracker from './progressTracker.js';

/**
 * @typedef {Object} ImageInfo
 * @property {string} filename - The filename of the image
 * @property {string} url - The original URL of the image (high quality)
 * @property {string} tweetUrl - The URL of the tweet containing the image
 * @property {string} tweetId - The ID of the tweet
 * @property {string} tweetDate - The publication date of the tweet (ISO format)
 * @property {string | null} status_reason - Reason if skipped or failed
 */

class ImageService {
  constructor() {
    this.downloadedImageUrls = new Set();
    this.currentUsername = null;
    this.rateLimiter = {
      lastAction: 0,
      minDelayMedium: config.timeouts.medium || 3000,
      minDelayShort: config.timeouts.short / 2 || 500,
    };
    this.downloadQueueSize = 0;

    // Database context for incremental tracking
    this.currentAccountDbId = null;
    this.processedTweetIds = new Set();
    this.newestTweetIdThisRun = null;

    // Stats tracking
    this.tweetsProcessedCount = 0;
    this.imagesDownloadedCount = 0;
  }

  async randomDelay(min = config.timeouts.short, max = config.timeouts.medium) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    logger.debug(`Applying random delay: ${delay}ms`);
    await sleep(delay);
  }

  formatDateForFilename(isoDateString) {
    if (!isoDateString) return 'NODATE';
    try {
      const date = new Date(isoDateString);
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = date.getUTCDate().toString().padStart(2, '0');
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      const seconds = date.getUTCSeconds().toString().padStart(2, '0');
      return `${year}${month}${day}_${hours}${minutes}${seconds}`;
    } catch (e) {
      logger.warn(`Could not parse date: ${isoDateString}. Using 'NODATE'.`);
      return 'NODATE';
    }
  }

  async fetchAllImagesForUser(page, accountToFetch) {
    this.currentUsername = accountToFetch.replace("@", "");
    downloadTracker.reset();
    this.downloadedImageUrls.clear();
    this.tweetsProcessedCount = 0;
    this.imagesDownloadedCount = 0;

    // Initialize database context for incremental tracking
    try {
      const account = accountRepository.getOrCreate(this.currentUsername);
      this.currentAccountDbId = account.id;

      // Load previously processed tweet IDs into memory for fast lookup
      const previouslyProcessed = tweetRepository.getProcessedTweetIds(account.id, config.database.maxCachedTweetIds);
      this.processedTweetIds = new Set(previouslyProcessed);
      logger.info(`Loaded ${this.processedTweetIds.size} previously processed tweet IDs for @${this.currentUsername}`);
    } catch (dbError) {
      logger.warn(`Database error during init: ${dbError.message}. Continuing without incremental tracking.`);
      this.currentAccountDbId = null;
      this.processedTweetIds = new Set();
    }

    this.newestTweetIdThisRun = null;
    logger.info(`Starting image fetch for account: @${this.currentUsername}`);

    createImageDirectory(this.currentUsername);

    const mediaUrl = `${config.urls.base}/${this.currentUsername}/media`;
    const tweetUrls = await this.collectTweetUrlsFromMediaPage(page, mediaUrl);

    if (tweetUrls.size === 0) {
      logger.warn(`No new tweet URLs found on the media page for @${this.currentUsername}. This could be due to an empty media tab, a private account, all tweets already processed, a page structure change, or the account not existing.`);
      await this.cleanup();
      return;
    }

    logger.info(`Found ${tweetUrls.size} new tweet URLs to process for @${this.currentUsername}.`);

    // Start a processing run for resume capability
    const runInfo = progressTracker.startOrResumeRun(this.currentUsername, Array.from(tweetUrls));
    if (runInfo.isResume) {
      logger.info(`Resuming from previous run: ${runInfo.processedTweets}/${runInfo.totalTweets} already processed`);
    }

    // Apply download order: 'newest' = as-is (Twitter shows newest first), 'oldest' = reverse
    let tweetArray = Array.from(tweetUrls);
    if (config.download.order === 'oldest') {
      tweetArray = tweetArray.reverse();
      logger.info('Processing tweets in oldest-first order');
    } else {
      logger.info('Processing tweets in newest-first order');
    }

    for (let i = 0; i < tweetArray.length; i++) {
      const tweetUrl = tweetArray[i];
      logger.info(`Processing tweet ${i + 1}/${tweetArray.length} for @${this.currentUsername}: ${tweetUrl}`);
      await this.processSingleTweetWithDownload(page, tweetUrl, tweetArray.length);
      await this.randomDelay(config.timeouts.short, config.timeouts.medium);
    }

    while (this.downloadQueueSize > 0) {
      logger.info(`Waiting for ${this.downloadQueueSize} downloads to complete for @${this.currentUsername}...`);
      await sleep(2000);
    }

    // Update account metadata
    if (this.currentAccountDbId) {
      try {
        if (this.newestTweetIdThisRun) {
          accountRepository.updateLastRun(this.currentAccountDbId, this.newestTweetIdThisRun);
        }
        accountRepository.incrementStats(this.currentAccountDbId, this.tweetsProcessedCount, this.imagesDownloadedCount);
      } catch (dbError) {
        logger.warn(`Failed to update account stats: ${dbError.message}`);
      }
    }

    // Mark run as completed
    progressTracker.completeRun();

    await this.cleanup();
  }

  /**
   * Process a single tweet: navigate, extract images, download.
   * Shared logic between streaming and sequential modes.
   */
  async processSingleTweetWithDownload(page, tweetUrl, totalCount) {
    const tweetIdMatch = tweetUrl.match(config.regex.tweetIdFromUrl);
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : null;

    // Skip if already processed (double-check)
    if (tweetId && this.processedTweetIds.has(tweetId)) {
      logger.debug(`Skipping already-processed tweet: ${tweetId}`);
      return;
    }

    try {
      await this.applyRateLimit(this.rateLimiter.minDelayMedium);
      const tweetData = await this.getDataFromTweetPage(page, tweetUrl);

      if (tweetData && tweetData.imageUrls.length > 0) {
        // Record tweet in database
        let tweetDbId = null;
        if (this.currentAccountDbId) {
          try {
            tweetDbId = tweetRepository.create({
              tweetId: tweetData.tweetId,
              accountId: this.currentAccountDbId,
              tweetUrl: tweetUrl,
              tweetDate: tweetData.tweetDate,
              imageCount: tweetData.imageUrls.length,
              status: 'processed'
            });
          } catch (dbError) {
            logger.warn(`Failed to record tweet in database: ${dbError.message}`);
          }
        }

        // Track newest tweet ID for incremental updates
        if (tweetData.tweetId && (!this.newestTweetIdThisRun || BigInt(tweetData.tweetId) > BigInt(this.newestTweetIdThisRun))) {
          this.newestTweetIdThisRun = tweetData.tweetId;
        }

        logger.info(`Found ${tweetData.imageUrls.length} image(s) in tweet: ${tweetUrl}`);
        for (const imageUrl of tweetData.imageUrls) {
          const imageInfo = this.parseImageUrl(imageUrl, tweetUrl, tweetData.tweetDate, tweetData.tweetId);
          if (imageInfo) {
            const downloaded = await this.queueImageDownload(imageUrl, this.currentUsername, imageInfo, tweetDbId);
            if (downloaded) this.imagesDownloadedCount++;
          }
        }
        this.tweetsProcessedCount++;
      } else if (tweetData) {
        // Record tweet with 0 images
        if (this.currentAccountDbId && tweetData.tweetId) {
          try {
            tweetRepository.create({
              tweetId: tweetData.tweetId,
              accountId: this.currentAccountDbId,
              tweetUrl: tweetUrl,
              tweetDate: tweetData.tweetDate,
              imageCount: 0,
              status: 'processed'
            });
          } catch (dbError) {
            logger.warn(`Failed to record empty tweet in database: ${dbError.message}`);
          }
        }
        logger.info(`No images found or all are non-downloadable media in tweet: ${tweetUrl}`);
      } else {
        logger.warn(`Could not retrieve data for tweet: ${tweetUrl}`);
        // Record failed tweet
        if (this.currentAccountDbId && tweetId) {
          try {
            tweetRepository.create({
              tweetId: tweetId,
              accountId: this.currentAccountDbId,
              tweetUrl: tweetUrl,
              tweetDate: null,
              imageCount: 0,
              status: 'failed'
            });
          } catch (dbError) {
            logger.warn(`Failed to record failed tweet in database: ${dbError.message}`);
          }
        }
      }

      // Update progress tracker
      progressTracker.markTweetProcessed({ url: tweetUrl, success: !!tweetData });

    } catch (error) {
      logger.error(`Failed to process tweet ${tweetUrl}: ${error.message}`);
      downloadTracker.updateProgress('failed_tweet_processing', {
        filename: 'N/A',
        url: 'N/A',
        tweetUrl: tweetUrl,
        tweetId: tweetUrl.match(config.regex.tweetIdFromUrl)?.[1] || 'N/A',
        tweetDate: 'N/A',
        status_reason: `Tweet processing error: ${error.message}`
      });
    }
  }

  /**
   * Processes a single tweet and returns the data.
   * Used by parallel processor.
   * @param {import('puppeteer').Page} page - Browser page
   * @param {string} tweetUrl - Tweet URL
   * @returns {Promise<Object>} Tweet processing result
   */
  async processSingleTweet(page, tweetUrl) {
    const tweetData = await this.getDataFromTweetPage(page, tweetUrl);

    if (!tweetData) {
      return { success: false, imageUrls: [], error: 'Could not retrieve tweet data' };
    }

    return {
      success: true,
      tweetId: tweetData.tweetId,
      tweetDate: tweetData.tweetDate,
      imageUrls: tweetData.imageUrls
    };
  }

  /**
   * Navigates to the media page and collects all unique tweet permalinks.
   * Handles Twitter/X virtualization by extracting after every scroll step.
   * @param {import('puppeteer').Page} page - Puppeteer page object
   * @param {string} mediaPageUrl - URL of the user's media page
   * @returns {Promise<Set<string>>} - A set of tweet URLs
   */
  async collectTweetUrlsFromMediaPage(page, mediaPageUrl) {
    const tweetUrls = new Set();
    const allSeenTweetIds = new Set(); // Track ALL tweets seen (for scroll detection)
    let consecutiveKnownTweets = 0;
    const earlyStopEnabled = config.database.earlyStopEnabled;
    const earlyStopThreshold = config.database.earlyStopThreshold || 20;

    try {
      logger.info(`Navigating to media page: ${mediaPageUrl}`);
      await page.goto(mediaPageUrl, {
        waitUntil: "networkidle2",
        timeout: config.timeouts.long * 2,
      });

      await this.randomDelay();

      logger.info("Scrolling through timeline to collect tweet URLs...");

      let lastSeenCount = 0, stableRepeats = 0;
      const maxRepeats = 10; // Stop after 10 scroll iterations with no new content
      const maxScrolls = 1500; // Increased max scrolls

      // Convert processedTweetIds to array for passing to page context
      const knownTweetIds = Array.from(this.processedTweetIds);

      for (let i = 0; i < maxScrolls && stableRepeats < maxRepeats; ++i) {
        // Pass known tweet IDs to the page evaluation for incremental detection
        const chunk = await page.evaluate((username, knownIds) => {
          const baseUrl = "https://x.com";
          const normalizedUsername = username.toLowerCase();
          const knownSet = new Set(knownIds);

          const result = { newUrls: [], knownTweetIds: [], allTweetIds: [] };

          document.querySelectorAll('li[role="listitem"]').forEach(item => {
            const anchor = item.querySelector('a[role="link"][href*="/status/"]');
            if (!anchor) return;
            let href = anchor.getAttribute('href');
            if (
              href &&
              href.toLowerCase().includes(`/${normalizedUsername}/status/`)
            ) {
              const img = item.querySelector('img[src*="pbs.twimg.com/media/"]');
              const hasVideoOverlay = !!item.querySelector('svg[aria-label="Play"], div[aria-label*="Video"]');
              if (img && !hasVideoOverlay) {
                href = href.replace(/\/(photo|video)\/\d+$/, '');
                const cleanUrl = baseUrl + href.split('?')[0];

                // Extract tweet ID from URL
                const idMatch = href.match(/\/status\/(\d+)/);
                if (idMatch) {
                  const tweetId = idMatch[1];
                  result.allTweetIds.push(tweetId);

                  if (knownSet.has(tweetId)) {
                    result.knownTweetIds.push(tweetId);
                  } else {
                    result.newUrls.push(cleanUrl);
                  }
                }
              }
            }
          });
          return result;
        }, this.currentUsername, knownTweetIds);

        // Add new URLs to our set
        chunk.newUrls.forEach(url => tweetUrls.add(url));

        // Track ALL tweets seen (for scroll end detection)
        chunk.allTweetIds.forEach(id => allSeenTweetIds.add(id));

        // Track consecutive known tweets for early stopping (only when enabled)
        if (earlyStopEnabled) {
          if (chunk.knownTweetIds.length > 0 && chunk.newUrls.length === 0) {
            consecutiveKnownTweets += chunk.knownTweetIds.length;

            if (consecutiveKnownTweets >= earlyStopThreshold) {
              logger.info(`New tweets only: Found ${consecutiveKnownTweets} already-downloaded tweets. Stopping scroll.`);
              break;
            }
          } else if (chunk.newUrls.length > 0) {
            consecutiveKnownTweets = 0; // Reset counter when finding new tweets
          }
        }

        // Scroll a random distance between 300–500px
        const scrollDistance = 300 + Math.floor(Math.random() * 200);
        await page.evaluate((distance) => window.scrollBy(0, distance), scrollDistance);

        // Wait 300–800ms
        const delay = 300 + Math.floor(Math.random() * 500);
        await sleep(delay);

        // Occasionally wait longer to simulate "pausing"
        if (i % 12 === 0) {
          const longPause = 2000 + Math.floor(Math.random() * 2000);
          logger.debug(`Taking longer pause: ${longPause}ms`);
          await sleep(longPause);
        }

        // Track stable state based on ALL tweets seen (not just new ones)
        // This ensures we keep scrolling even if all tweets are already processed
        if (allSeenTweetIds.size === lastSeenCount) {
          stableRepeats++;
        } else {
          stableRepeats = 0;
          lastSeenCount = allSeenTweetIds.size;
        }

        // Log progress every 50 scrolls
        if (i > 0 && i % 50 === 0) {
          logger.info(`Scroll progress: ${allSeenTweetIds.size} tweets found (${tweetUrls.size} new)`);
        }
      }

      logger.info(`Scroll complete. Total tweets seen: ${allSeenTweetIds.size}, New tweets to process: ${tweetUrls.size}`);
    } catch (error) {
      logger.error(`Error collecting tweet URLs from media page: ${error.message}`);
      throw new Error(`Failed to load or scrape media page ${mediaPageUrl}: ${error.message}`);
    }
    return tweetUrls;
  }

  async getDataFromTweetPage(page, tweetUrl) {
    const maxRetries = config.retry.maxTweetRetries || 3;
    const baseDelay = config.retry.retryBaseDelay || 2000;
    const tweetIdMatch = tweetUrl.match(config.regex.tweetIdFromUrl);
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : 'UNKNOWN_ID';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`Navigating to tweet page (attempt ${attempt}/${maxRetries}): ${tweetUrl}`);
        await page.goto(tweetUrl, {
          waitUntil: "networkidle2",
          timeout: config.timeouts.navigation,
        });
        await this.randomDelay(1000, 2500);

        // It's crucial that tweetArticleSelector is correct and the element is present
        try {
          await page.waitForSelector(config.selectors.tweetArticleSelector, { timeout: config.timeouts.selector });
        } catch (e) {
          // Tweet might be deleted or page structure changed - not worth retrying
          logger.warn(`Tweet article selector not found on ${tweetUrl}. Tweet might be deleted or page structure changed.`);
          return null;
        }

        const tweetData = await page.evaluate((dateSelector, imageSelector, carouselImageSelector, articleSelector) => {
          const article = document.querySelector(articleSelector);
          if (!article) return null;

          let tweetDate = null;
          const timeElement = article.querySelector(dateSelector);
          if (timeElement) {
            tweetDate = timeElement.getAttribute('datetime');
          }

          const foundImages = new Set();
          // Primary image selector for single images or main image in a set
          article.querySelectorAll(imageSelector).forEach(imgOrVideo => {
            const src = imgOrVideo.tagName === 'VIDEO' ? imgOrVideo.getAttribute('poster') : imgOrVideo.src;
            if (src && src.includes('pbs.twimg.com/media/')) {
              foundImages.add(src.replace(/name=\w+$/, "name=orig").replace(/\?format=([a-zA-Z0-9_]+)&name=([a-zA-Z0-9_]+)$/, "?format=$1&name=orig"));
            }
          });

          // Fallback/carousel image selector
          article.querySelectorAll(carouselImageSelector).forEach(img => {
            const src = img.src;
            if (src && src.includes('pbs.twimg.com/media/')) {
              foundImages.add(src.replace(/name=\w+$/, "name=orig").replace(/\?format=([a-zA-Z0-9_]+)&name=([a-zA-Z0-9_]+)$/, "?format=$1&name=orig"));
            }
          });

          return { imageUrls: Array.from(foundImages), tweetDate };
        }, config.selectors.tweetDateSelector, config.selectors.tweetPageImage, config.selectors.tweetPageCarouselImage, config.selectors.tweetArticleSelector);

        if (!tweetData) {
          logger.warn(`Could not extract tweet data (images/date) from article on page: ${tweetUrl}`);
          return null;
        }

        const finalImageUrls = tweetData.imageUrls.filter(url => url && !url.endsWith('.svg') && !url.includes('profile_images') && !url.includes('emoji'));

        return { imageUrls: finalImageUrls, tweetId, tweetDate: tweetData.tweetDate };

      } catch (error) {
        const isRetryable = error.message.includes('timeout') ||
                           error.message.includes('Navigation') ||
                           error.message.includes('net::') ||
                           error.message.includes('Protocol error');

        if (isRetryable && attempt < maxRetries) {
          const retryDelay = baseDelay * attempt;
          logger.warn(`Tweet page navigation failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${retryDelay}ms...`);
          await sleep(retryDelay);
        } else {
          logger.error(`Error extracting data from tweet ${tweetUrl} (attempt ${attempt}/${maxRetries}): ${error.message}`);
          return null;
        }
      }
    }
    return null;
  }

  parseImageUrl(imageUrl, tweetUrl, tweetDate, tweetId) {
    const cleanedUrl = imageUrl.replace(/name=\w+$/, 'name=orig').replace(/\?format=([a-zA-Z0-9_]+)&name=([a-zA-Z0-9_]+)$/, '?format=$1&name=orig');
    const imageDetailsMatch = cleanedUrl.match(/https:\/\/pbs\.twimg\.com\/media\/([^.?]+)\??(?:format=([^&]+))?/);

    if (imageDetailsMatch) {
      const baseImageName = imageDetailsMatch[1];
      let imageExtension = imageDetailsMatch[2];
      const nameParts = baseImageName.split('.');
      let imageNameWithoutExt = baseImageName;

      if (nameParts.length > 1 && !imageExtension) { // e.g. F_xyz.jpg
        imageExtension = nameParts.pop();
        imageNameWithoutExt = nameParts.join('.');
      } else if (nameParts.length > 1 && imageExtension) { // e.g. F_xyz.jpg?format=jpg (take F_xyz) or F_xyz?format=jpg
        imageNameWithoutExt = nameParts[0]; // Handles cases like "ImageName.jpg?format=jpg", takes "ImageName"
      } else if (nameParts.length === 1 && !imageExtension) { // e.g. F_xyz (no extension in name, no format param)
        imageNameWithoutExt = baseImageName;
        // imageExtension will be set to jpg by default later
      }


      if (!imageExtension) {
        imageExtension = 'jpg';
        logger.debug(`No extension found for ${imageNameWithoutExt} from ${cleanedUrl}, defaulting to .jpg`);
      }

      const validExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
      if (!validExtensions.includes(imageExtension.toLowerCase())) {
        logger.warn(`Invalid extension '${imageExtension}' for ${imageNameWithoutExt} from ${cleanedUrl}. Defaulting to 'jpg'.`);
        imageExtension = 'jpg';
      }

      const formattedDate = this.formatDateForFilename(tweetDate);
      // Ensure imageNameWithoutExt doesn't have an extension remnant if one was also in format param
      const finalImageNamePart = imageNameWithoutExt.split('.')[0];

      const filename = `${formattedDate}_${tweetId}_${finalImageNamePart}.${imageExtension}`;

      return {
        filename,
        url: cleanedUrl,
        tweetUrl,
        tweetId,
        tweetDate: tweetDate || 'N/A',
        status_reason: null
      };
    }
    logger.warn(`Could not parse image details from URL: ${imageUrl}`);
    return null;
  }

  async applyRateLimit(minDelay) {
    const now = Date.now();
    const timeSinceLastAction = now - this.rateLimiter.lastAction;
    if (timeSinceLastAction < minDelay) {
      const delay = minDelay - timeSinceLastAction;
      logger.debug(`Rate limiting: waiting for ${delay}ms`);
      await sleep(delay);
    }
    this.rateLimiter.lastAction = Date.now();
  }

  async queueImageDownload(imageUrl, accountToFetch, imageInfo, tweetDbId = null) {
    // Check in-memory cache first
    if (this.downloadedImageUrls.has(imageInfo.url)) {
      return false;
    }

    // Check database for already-downloaded image
    try {
      if (imageRepository.isDownloaded(imageInfo.url)) {
        logger.debug(`Skipping image already in database: ${imageInfo.filename}`);
        this.downloadedImageUrls.add(imageInfo.url);
        return false;
      }
    } catch (dbError) {
      // Continue without DB check if it fails
    }

    const dirPath = path.join(process.cwd(), 'images', accountToFetch);
    const filePath = path.join(dirPath, imageInfo.filename);

    // File-existence fallback (covers edge cases)
    if (fs.existsSync(filePath)) {
      logger.info(`Skipping existing file: ${imageInfo.filename}`);
      downloadTracker.updateProgress('skipped', { ...imageInfo, status_reason: 'File exists locally' });
      this.downloadedImageUrls.add(imageInfo.url);

      // Record in database if we have context
      if (tweetDbId) {
        try {
          imageRepository.create({
            tweetDbId,
            imageUrl: imageInfo.url,
            filename: imageInfo.filename,
            filePath: filePath,
            status: 'skipped',
            statusReason: 'File exists locally'
          });
        } catch (dbError) {
          // Ignore DB errors for skip recording
        }
      }
      return false;
    }

    this.downloadQueueSize++;
    try {
      await this.applyRateLimit(this.rateLimiter.minDelayShort);
      const fileSize = await this.downloadImage(imageInfo, filePath);
      this.downloadedImageUrls.add(imageInfo.url);

      // Record successful download in database
      if (tweetDbId) {
        try {
          imageRepository.create({
            tweetDbId,
            imageUrl: imageInfo.url,
            filename: imageInfo.filename,
            filePath: filePath,
            status: 'downloaded',
            statusReason: null,
            fileSize: fileSize
          });
        } catch (dbError) {
          logger.warn(`Failed to record download in database: ${dbError.message}`);
        }
      }
      return true;
    } catch (error) {
      // Record failed download in database
      if (tweetDbId) {
        try {
          imageRepository.create({
            tweetDbId,
            imageUrl: imageInfo.url,
            filename: imageInfo.filename,
            filePath: filePath,
            status: 'failed',
            statusReason: error.message
          });
        } catch (dbError) {
          // Ignore DB errors for failure recording
        }
      }
      return false;
    } finally {
      this.downloadQueueSize--;
    }
  }

  validateImageResponse(response, imageUrl) {
    const contentType = response.headers['content-type'];
    const contentLength = parseInt(response.headers['content-length'], 10);

    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`Invalid content type: ${contentType} for ${imageUrl}`);
    }
    if (contentLength && contentLength > 50 * 1024 * 1024) { // 50MB limit
      throw new Error(`File too large: ${contentLength} bytes for ${imageUrl}`);
    }
    // Allow small GIFs, but be wary of other small image types.
    if (contentLength && contentLength < 500 && (!contentType.includes('gif') || contentLength < 100)) {
      throw new Error(`File too small: ${contentLength} bytes for ${imageUrl}. Might be an error or placeholder.`);
    }
    return true;
  }

  async downloadImage(imageInfo, filePath) {
    const maxRetries = 3;
    let retryCount = 0;
    while (retryCount < maxRetries) {
      try {
        const response = await axios({
          url: imageInfo.url,
          method: 'GET',
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': config.userAgent,
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': imageInfo.tweetUrl // Adding referer can sometimes help
          },
          timeout: config.timeouts.long * 2, // Increased timeout
        });
        this.validateImageResponse(response, imageInfo.url);
        await fs.promises.writeFile(filePath, response.data);
        logger.success(`Downloaded: ${imageInfo.filename} (Tweet: ${imageInfo.tweetUrl})`);
        downloadTracker.updateProgress('downloaded', imageInfo);
        return response.data.length; // Return file size
      } catch (error) {
        retryCount++;
        const attemptErrorMessage = `Download attempt ${retryCount}/${maxRetries} failed for ${imageInfo.filename}: ${error.message}`;
        logger.warn(attemptErrorMessage);
        if (retryCount === maxRetries) {
          logger.error(`Final download attempt failed for ${imageInfo.filename} from ${imageInfo.url}`);
          // Ensure status_reason is part of the object passed to updateProgress
          downloadTracker.updateProgress('failed', { ...imageInfo, status_reason: error.message });
          throw error;
        }
        await sleep(config.timeouts.short * retryCount);
      }
    }
  }

  async cleanup() {
    process.stdout.write('\n');
    if (this.currentUsername) {
      downloadTracker.printSummary(this.currentUsername);
      await downloadTracker.exportToCsv(this.currentUsername);
    } else {
      logger.info("No user processed in this session, skipping summary and CSV export.");
    }
    process.stdout.write('\n');
    this.rateLimiter.lastAction = 0;
  }
}

export default new ImageService();

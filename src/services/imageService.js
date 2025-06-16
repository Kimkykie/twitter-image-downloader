// src/services/imageService.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import downloadTracker from '../utils/downloadTracker.js';
import { createImageDirectory, ensureDirectoryExists } from '../utils/fileSystem.js';
import { setTimeout as sleep } from 'node:timers/promises'; // For delays

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
    logger.info(`Starting image fetch for account: @${this.currentUsername}`);

    createImageDirectory(this.currentUsername);

    const mediaUrl = `${config.urls.base}/${this.currentUsername}/media`;
    const tweetUrls = await this.collectTweetUrlsFromMediaPage(page, mediaUrl);

    if (tweetUrls.size === 0) {
      logger.warn(`No tweet URLs found on the media page for @${this.currentUsername}. This could be due to an empty media tab, a private account, a page structure change, or the account not existing.`);
      await this.cleanup();
      return;
    }

    logger.info(`Found ${tweetUrls.size} unique tweet URLs to process for @${this.currentUsername}.`);

    const tweetArray = Array.from(tweetUrls).reverse();
    for (let i = 0; i < tweetArray.length; i++) {
      const tweetUrl = tweetArray[i];
      logger.info(`Processing tweet ${i + 1}/${tweetArray.length} for @${this.currentUsername}: ${tweetUrl}`);
      try {
        await this.applyRateLimit(this.rateLimiter.minDelayMedium);
        const tweetData = await this.getDataFromTweetPage(page, tweetUrl);

        if (tweetData && tweetData.imageUrls.length > 0) {
          logger.info(`Found ${tweetData.imageUrls.length} image(s) in tweet: ${tweetUrl}`);
          for (const imageUrl of tweetData.imageUrls) {
            const imageInfo = this.parseImageUrl(imageUrl, tweetUrl, tweetData.tweetDate, tweetData.tweetId);
            if (imageInfo) {
              await this.queueImageDownload(imageUrl, this.currentUsername, imageInfo);
            }
          }
        } else if (tweetData) {
          logger.info(`No images found or all are non-downloadable media in tweet: ${tweetUrl}`);
        } else {
          logger.warn(`Could not retrieve data for tweet: ${tweetUrl}`);
        }
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
      await this.randomDelay(config.timeouts.short, config.timeouts.medium);
    }

    while (this.downloadQueueSize > 0) {
      logger.info(`Waiting for ${this.downloadQueueSize} downloads to complete for @${this.currentUsername}...`);
      await sleep(2000);
    }
    await this.cleanup();
  }

  /**
    * Navigates to the media page and collects all unique tweet permalinks.
    * @param {import('puppeteer').Page} page - Puppeteer page object
    * @param {string} mediaPageUrl - URL of the user's media page
    * @returns {Promise<Set<string>>} - A set of tweet URLs
    */
  /**
 * Navigates to the media page and collects all unique tweet permalinks.
 * Handles Twitter/X virtualization by extracting after every scroll step.
 * @param {import('puppeteer').Page} page - Puppeteer page object
 * @param {string} mediaPageUrl - URL of the user's media page
 * @returns {Promise<Set<string>>} - A set of tweet URLs
 */
  async collectTweetUrlsFromMediaPage(page, mediaPageUrl) {
    const tweetUrls = new Set();
    try {
      logger.info(`Navigating to media page: ${mediaPageUrl}`);
      await page.goto(mediaPageUrl, {
        waitUntil: "networkidle2",
        timeout: config.timeouts.long * 2,
      });

      await this.randomDelay();

      logger.info("Progressive scroll & extraction with human-like behavior...");

      let lastCount = 0, stableRepeats = 0;
      const maxRepeats = 7;
      const maxScrolls = 700;

      for (let i = 0; i < maxScrolls && stableRepeats < maxRepeats; ++i) {
        const chunk = await page.evaluate((username) => {
          const baseUrl = "https://x.com";
          const normalizedUsername = username.toLowerCase();

          const tweetUrlsSet = new Set();
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
                tweetUrlsSet.add(baseUrl + href.split('?')[0]);
              }
            }
          });
          return Array.from(tweetUrlsSet);
        }, this.currentUsername);

        chunk.forEach(url => tweetUrls.add(url));

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

        // Track stable state
        if (tweetUrls.size === lastCount) {
          stableRepeats++;
        } else {
          stableRepeats = 0;
          lastCount = tweetUrls.size;
        }
      }

      logger.info(`Progressive extraction complete. Unique tweet URLs collected: ${tweetUrls.size}`);
    } catch (error) {
      logger.error(`Error collecting tweet URLs from media page: ${error.message}`);
      throw new Error(`Failed to load or scrape media page ${mediaPageUrl}: ${error.message}`);
    }
    return tweetUrls;
  }

  async getDataFromTweetPage(page, tweetUrl) {
    try {
      logger.debug(`Navigating to tweet page: ${tweetUrl}`);
      await page.goto(tweetUrl, {
        waitUntil: "networkidle2",
        timeout: config.timeouts.navigation,
      });
      await this.randomDelay(1000, 2500);

      const tweetIdMatch = tweetUrl.match(config.regex.tweetIdFromUrl);
      const tweetId = tweetIdMatch ? tweetIdMatch[1] : 'UNKNOWN_ID';

      // It's crucial that tweetArticleSelector is correct and the element is present
      try {
        await page.waitForSelector(config.selectors.tweetArticleSelector, { timeout: config.timeouts.selector });
      } catch (e) {
        logger.warn(`Tweet article selector "${config.selectors.tweetArticleSelector}" not found on ${tweetUrl}. Tweet might be deleted or page structure changed.`);
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
      logger.error(`Error extracting data from tweet ${tweetUrl}: ${error.message}`);
      return null;
    }
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

  async queueImageDownload(imageUrl, accountToFetch, imageInfo) {
    if (this.downloadedImageUrls.has(imageInfo.url)) {
      return;
    }
    const dirPath = path.join(process.cwd(), 'images', accountToFetch);
    const filePath = path.join(dirPath, imageInfo.filename);

    if (fs.existsSync(filePath)) {
      logger.info(`Skipping existing file: ${imageInfo.filename}`);
      downloadTracker.updateProgress('skipped', { ...imageInfo, status_reason: 'File exists locally' });
      this.downloadedImageUrls.add(imageInfo.url);
      return;
    }

    this.downloadQueueSize++;
    try {
      await this.applyRateLimit(this.rateLimiter.minDelayShort);
      await this.downloadImage(imageInfo, filePath);
      this.downloadedImageUrls.add(imageInfo.url);
    } catch (error) {
      // Error already logged by downloadImage and progress updated to 'failed'
      // logger.error(`Queue: Download failed for ${imageInfo.filename}: ${error.message}`);
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
        return;
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

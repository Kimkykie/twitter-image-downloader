// src/services/imageService.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import downloadTracker from '../utils/downloadTracker.js';
import { createImageDirectory, ensureDirectoryExists } from '../utils/fileSystem.js';
import browserService from './browserService.js'; // For autoScroll
import { setTimeout as sleep } from 'node:timers/promises'; // For delays

/**
 * @typedef {Object} ImageInfo
 * @property {string} filename - The filename of the image
 * @property {string} url - The original URL of the image
 * @property {string} tweetUrl - The URL of the tweet containing the image
 */

/**
 * @typedef {Object} RateLimiter
 * @property {number} lastAction - Timestamp of the last significant action (e.g., page load)
 * @property {number} minDelay - Minimum delay between actions in milliseconds
 */

class ImageService {
  constructor() {
    this.downloadedImageUrls = new Set(); // Tracks URLs of successfully downloaded/skipped images to avoid re-processing
    this.currentUsername = null;
    this.rateLimiter = {
      lastAction: 0,
      minDelayMedium: config.timeouts.medium || 3000, // Delay between navigating to tweet pages
      minDelayShort: 500, // Delay for downloads (already in your old code)
    };
    this.downloadQueueSize = 0; // To track active downloads for graceful shutdown
  }

  /**
   * Introduces a random delay.
   * @param {number} min - Minimum delay in ms
   * @param {number} max - Maximum delay in ms
   */
  async randomDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await sleep(delay);
  }

  /**
   * Main function to fetch all images for a user.
   * @param {import('puppeteer').Page} page - Puppeteer page object
   * @param {string} accountToFetch - Twitter username
   */
  async fetchAllImagesForUser(page, accountToFetch) {
    this.currentUsername = accountToFetch.replace("@", "");
    downloadTracker.reset();
    this.downloadedImageUrls.clear();
    logger.info(`Starting image fetch for account: @${this.currentUsername}`);

    createImageDirectory(this.currentUsername); // Ensure directory exists

    const mediaUrl = `${config.urls.base}/${this.currentUsername}/media`;
    const tweetUrls = await this.collectTweetUrlsFromMediaPage(page, mediaUrl);

    if (tweetUrls.size === 0) {
      logger.warn(`No tweet URLs found on the media page for @${this.currentUsername}.`);
      await this.cleanup();
      return;
    }

    logger.info(`Found ${tweetUrls.size} unique tweet URLs to process.`);

    const tweetArray = Array.from(tweetUrls); // Convert Set to Array for sequential processing
    for (let i = 0; i < tweetArray.length; i++) {
      const tweetUrl = tweetArray[i];
      logger.info(`Processing tweet ${i + 1}/${tweetArray.length}: ${tweetUrl}`);
      try {
        await this.applyRateLimit(this.rateLimiter.minDelayMedium); // Rate limit before navigating to tweet page
        const imageUrls = await this.getAllImagesFromTweetPage(page, tweetUrl);
        if (imageUrls.length > 0) {
          logger.info(`Found ${imageUrls.length} image(s) in tweet: ${tweetUrl}`);
          for (const imageUrl of imageUrls) {
            const imageInfo = this.parseImageUrl(imageUrl, tweetUrl);
            if (imageInfo) {
              await this.queueImageDownload(imageUrl, this.currentUsername, imageInfo);
            }
          }
        } else {
          logger.info(`No images found or all are GIFs/videos in tweet: ${tweetUrl}`);
        }
      } catch (error) {
        logger.error(`Failed to process tweet ${tweetUrl}: ${error.message}`);
        // Optionally, add to a retry queue or log for later inspection
      }
      await this.randomDelay(config.timeouts.short, config.timeouts.medium); // Random delay between processing tweets
    }

    // Wait for any ongoing downloads to complete before cleanup
    while (this.downloadQueueSize > 0) {
        logger.info(`Waiting for ${this.downloadQueueSize} downloads to complete...`);
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
  async collectTweetUrlsFromMediaPage(page, mediaPageUrl) {
    const tweetUrls = new Set();
    try {
      logger.info(`Navigating to media page: ${mediaPageUrl}`);
      await page.goto(mediaPageUrl, {
        waitUntil: "networkidle2",
        timeout: config.timeouts.long * 2,
      });

      await this.randomDelay();

      logger.info("Starting auto-scroll to load all media tweets...");
      await browserService.autoScroll(page);
      logger.info("Auto-scroll finished. Extracting tweet URLs...");

      const collectedUrls = await page.evaluate((username) => {
        const urls = new Set();
        const baseUrl = "https://twitter.com";
        const normalizedUsername = username.toLowerCase();

        const items = document.querySelectorAll('li[role="listitem"]');

        items.forEach((item) => {
          const links = item.querySelectorAll('a[href*="/status/"]');
          links.forEach((link) => {
            const href = link.getAttribute("href");
            if (href && href.includes("/status/")) {
              const fullUrl = baseUrl + href.split("?")[0];
              if (fullUrl.toLowerCase().includes(`/${normalizedUsername}/status/`)) {
                urls.add(fullUrl);
              }
            }
          });
        });

        return Array.from(urls);
      }, this.currentUsername);

      collectedUrls.forEach((url) => tweetUrls.add(url));

    } catch (error) {
      logger.error(`Error collecting tweet URLs from media page: ${error.message}`);
      throw new Error(`Failed to load or scrape media page ${mediaPageUrl}: ${error.message}`);
    }

    return tweetUrls;
  }

  /**
   * Navigates to an individual tweet page and extracts all image URLs.
   * @param {import('puppeteer').Page} page - Puppeteer page object
   * @param {string} tweetUrl - URL of the individual tweet
   * @returns {Promise<string[]>} - An array of image URLs
   */
  async getAllImagesFromTweetPage(page, tweetUrl) {
    const imageUrls = [];
    try {
      logger.debug(`Navigating to tweet page: ${tweetUrl}`);
      await page.goto(tweetUrl, {
        waitUntil: "networkidle2",
        timeout: config.timeouts.long,
      });
      await this.randomDelay(1000, 2000); // Shorter delay after tweet page load

      const imagesOnPage = await page.evaluate(() => {
        const foundImages = new Set();

        // Get the main tweet's article
        const article = document.querySelector('article[role="article"]');
        if (!article) return [];

        // Find all tweet photos by data-testid
        const photoContainers = article.querySelectorAll('[data-testid="tweetPhoto"]');

        // For each photo container, extract the actual image URL
        photoContainers.forEach((container) => {
          // Find the img tag inside the photo container
          const img = container.querySelector('img');
          if (img && img.src) {
            // Get the original source URL
            let src = img.src;

            // Convert to original quality
            const isMediaImage = src.includes("twimg.com/media/");
            if (isMediaImage) {
              // Handle both formats:
              // https://pbs.twimg.com/media/XYZ?format=jpg&name=small
              // https://pbs.twimg.com/media/XYZ.jpg
              const cleanedSrc = src
                .replace(/name=\w+$/, "name=orig")
                .replace(/\?format=([a-zA-Z0-9_]+)&name=([a-zA-Z0-9_]+)$/, "?format=$1&name=orig");

              foundImages.add(cleanedSrc);
            }
          }

          // Some tweets have images as background styles
          const backgroundDiv = container.querySelector('div[style*="background-image"]');
          if (backgroundDiv) {
            const style = backgroundDiv.getAttribute('style');
            const match = style.match(/url\("([^"]+)"\)/);
            if (match && match[1]) {
              let bgSrc = match[1];

              // Check if this is a media image
              const isMediaImage = bgSrc.includes("twimg.com/media/");
              if (isMediaImage) {
                const cleanedSrc = bgSrc
                  .replace(/name=\w+$/, "name=orig")
                  .replace(/\?format=([a-zA-Z0-9_]+)&name=([a-zA-Z0-9_]+)$/, "?format=$1&name=orig");

                foundImages.add(cleanedSrc);
              }
            }
          }
        });

        return Array.from(foundImages);
      });

      imageUrls.push(...imagesOnPage);
    } catch (error) {
      logger.error(`Error extracting images from tweet ${tweetUrl}: ${error.message}`);
      // Continue to the next tweet even if one fails
    }

    // Final filtering step just in case
    return imageUrls.filter((url) => !url.includes(".svg"));
  }

  /**
   * Parses an image URL to get filename and other details.
   * @param {string} imageUrl - The raw image URL.
   * @param {string} tweetUrl - The source tweet URL.
   * @returns {ImageInfo|null}
   */
  parseImageUrl(imageUrl, tweetUrl) {
    // Ensure we aim for the highest quality, typically ':orig' or ':large'
    const cleanedUrl = imageUrl.replace(/name=\w+$/, 'name=orig').replace(/\?format=([a-zA-Z0-9_]+)&name=([a-zA-Z0-9_]+)$/, '?format=$1&name=orig');

    // Updated regex to better capture filename and extension from various URL formats
    // e.g., https://pbs.twimg.com/media/F_xyz123abcDEF.jpg?format=jpg&name=orig
    //      https://pbs.twimg.com/media/F_xyz123abcDEF.png
    const imageDetailsMatch = cleanedUrl.match(/https:\/\/pbs\.twimg\.com\/media\/([^.?]+)\??(?:format=([^&]+))?/);

    if (imageDetailsMatch) {
      const imageName = imageDetailsMatch[1];
      // Determine extension: from 'format=' param or from the imageName if it has one.
      let imageExtension = imageDetailsMatch[2]; // from format=
      if (!imageExtension) {
        const nameParts = imageName.split('.');
        if (nameParts.length > 1) {
          imageExtension = nameParts.pop(); // from filename itself e.g. .jpg
        } else {
            imageExtension = 'jpg'; // Default if no extension found in format or filename
            logger.warn(`Could not determine extension for ${imageName} from ${cleanedUrl}, defaulting to .jpg`);
        }
      }

      // Ensure extension is valid, default if not
      const validExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
      if (!validExtensions.includes(imageExtension.toLowerCase())) {
          logger.warn(`Invalid or missing extension '${imageExtension}' for ${imageName} from ${cleanedUrl}, attempting to use 'jpg'. Original URL: ${imageUrl}`);
          imageExtension = 'jpg'; // Fallback extension
      }


      return {
        filename: `${imageName}.${imageExtension}`,
        url: cleanedUrl,
        tweetUrl: tweetUrl,
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
      // No need to call updateProgress if we've already processed this exact URL fully.
      // downloadTracker.updateProgress('skipped', { ...imageInfo, status_reason: 'URL already processed' });
      return;
    }

    // Check if file already exists (more robust deduplication)
    const dirPath = path.join(process.cwd(), 'images', accountToFetch);
    ensureDirectoryExists(dirPath); // Ensure base and user directory exist
    const filePath = path.join(dirPath, imageInfo.filename);

    if (fs.existsSync(filePath)) {
      logger.info(`Skipping existing file: ${imageInfo.filename}`);
      downloadTracker.updateProgress('skipped', { ...imageInfo, status_reason: 'File exists' });
      this.downloadedImageUrls.add(imageInfo.url); // Add to set even if skipped locally
      return;
    }

    this.downloadQueueSize++;
    try {
      await this.applyRateLimit(this.rateLimiter.minDelayShort); // Rate limit for downloads
      await this.downloadImage(imageUrl, accountToFetch, imageInfo, filePath);
      this.downloadedImageUrls.add(imageInfo.url); // Add to set on successful download
    } catch (error) {
      // downloadTracker.updateProgress('failed', imageInfo) is called within downloadImage
      logger.error(`Failed to download or queue ${imageInfo.filename} from ${imageInfo.url}: ${error.message}`);
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
    // Twitter images are usually not excessively large, but good to have a check.
    if (contentLength && contentLength > 25 * 1024 * 1024) { // 25MB limit
      throw new Error(`File too large: ${contentLength} bytes for ${imageUrl}`);
    }
    if (contentLength && contentLength < 1024 && !contentType.includes('gif')) { // 1KB, might be an error page or tiny placeholder, ignore for GIFs
        throw new Error(`File too small: ${contentLength} bytes for ${imageUrl}. Might be an error or placeholder.`);
    }
    return true;
  }

  async downloadImage(imageUrl, accountToFetch, imageInfo, filePath) {
    // filePath is now passed in
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const response = await axios({
          url: imageInfo.url, // Use the cleaned URL from imageInfo
          method: 'GET',
          responseType: 'arraybuffer',
          headers: { 'User-Agent': config.userAgent },
          timeout: config.timeouts.long, // Generous timeout for image download
        });

        this.validateImageResponse(response, imageInfo.url);
        await fs.promises.writeFile(filePath, response.data);
        logger.success(`Downloaded: ${imageInfo.filename} (Tweet: ${imageInfo.tweetUrl})`);
        downloadTracker.updateProgress('downloaded', imageInfo);
        return;
      } catch (error) {
        retryCount++;
        logger.warn(`Download attempt ${retryCount}/${maxRetries} failed for ${imageInfo.filename}: ${error.message}`);
        if (retryCount === maxRetries) {
          logger.error(`Final download attempt failed for ${imageInfo.filename} from ${imageInfo.url}`);
          downloadTracker.updateProgress('failed', { ...imageInfo, status_reason: error.message });
          throw error; // Re-throw after final attempt
        }
        await sleep(1500 * retryCount); // Exponential backoff for retries
      }
    }
  }

  async cleanup() {
    // No page listeners to remove in this new flow directly in imageService,
    // but good practice if any were added elsewhere for the page.

    process.stdout.write('\n');
    downloadTracker.printSummary();
    if (this.currentUsername) {
      await downloadTracker.exportToCsv(this.currentUsername);
    }
    process.stdout.write('\n');

    // Reset state for potential next run
    this.currentUsername = null;
    this.downloadedImageUrls.clear();
    this.rateLimiter.lastAction = 0;
  }
}

export default new ImageService();

// src/services/imageService.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { createImageDirectory } from '../utils/fileSystem.js';

class ImageService {
  constructor() {
    this.downloadQueue = new Set();
    this.currentUsername = null;
    this.rateLimiter = {
      lastDownload: 0,
      minDelay: 500  // Minimum delay between downloads
    };
  }

  /**
   * Sets up image download listeners on the page
   * @param {Object} page - Puppeteer page object
   * @param {string} accountToFetch - Twitter username to fetch images from
   */
  setupImageDownloadListeners(page, accountToFetch) {
    // Clear existing listeners if any
    page.removeAllListeners('response');

    this.currentUsername = accountToFetch;

    page.on("response", async (response) => {
      const url = response.url();
      if (response.request().resourceType() === "image" && url.match(config.regex.imageUrl)) {
        const cleanurl = url.replace(config.regex.urlCleaner, "&name=large");

        try {
          const imageDetails = cleanurl.match(config.regex.imageDetails);
          if (imageDetails) {
            const imageName = imageDetails[1];
            const imageExtension = imageDetails[2];
            logger.info(`Downloading... ${imageName}.${imageExtension}`);
            await this.queueImageDownload(cleanurl, this.currentUsername);
          }
        } catch (error) {
          logger.error("Error processing image URL:", error);
        }
      }
    });

    logger.info(`Set up image listeners for account: ${accountToFetch}`);
  }

  /**
   * Navigates to the media page of a Twitter account
   * @param {Object} page - Puppeteer page object
   * @param {string} accountToFetch - Twitter username to fetch images from
   */
  async navigateToMediaPage(page, accountToFetch) {
    const username = accountToFetch.replace("@", "");
    const mediaUrl = `${config.urls.base}/${username}/media`;

    try {
      await page.goto(mediaUrl, {
        waitUntil: "networkidle0",
        timeout: config.timeouts.long
      });
      logger.info(`Navigated to media page: ${mediaUrl}`);
    } catch (error) {
      logger.error(`Failed to navigate to ${mediaUrl}:`, error);
      throw error;
    }
  }

  /**
   * Rate limits downloads to prevent overwhelming the server
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastDownload = now - this.rateLimiter.lastDownload;

    if (timeSinceLastDownload < this.rateLimiter.minDelay) {
      const delay = this.rateLimiter.minDelay - timeSinceLastDownload;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.rateLimiter.lastDownload = Date.now();
  }

  /**
   * Queues an image for download with rate limiting
   * @param {string} imageUrl - URL of the image to download
   * @param {string} accountToFetch - Twitter username the image belongs to
   */
  async queueImageDownload(imageUrl, accountToFetch) {
    if (this.downloadQueue.has(imageUrl)) {
      logger.info('Skipping duplicate image:', imageUrl);
      return;
    }

    this.downloadQueue.add(imageUrl);

    try {
      await this.rateLimit();
      await this.downloadImage(imageUrl, accountToFetch);
    } catch (error) {
      logger.error('Error downloading image:', error);
    } finally {
      this.downloadQueue.delete(imageUrl);
    }
  }

  /**
   * Validates image response before processing
   * @param {Object} response - Axios response object
   */
  validateImageResponse(response) {
    const contentType = response.headers['content-type'];
    const contentLength = response.headers['content-length'];

    if (!contentType?.startsWith('image/')) {
      throw new Error('Invalid content type');
    }

    if (contentLength && parseInt(contentLength) > 15 * 1024 * 1024) {
      throw new Error('File too large');
    }

    return true;
  }

  /**
   * Downloads a single image
   * @param {string} imageUrl - URL of the image to download
   * @param {string} accountToFetch - Twitter username the image belongs to
   */
  async downloadImage(imageUrl, accountToFetch) {
    try {
      const imageDetails = imageUrl.match(config.regex.imageDetails);
      if (!imageDetails) {
        throw new Error('Invalid image URL format');
      }

      const [, imageName, imageExtension] = imageDetails;
      const dirPath = path.join('./images', accountToFetch);

      // Ensure directory exists
      if (!fs.existsSync(dirPath)) {
        createImageDirectory(accountToFetch);
      }

      const filePath = path.join(dirPath, `${imageName}.${imageExtension}`);

      // Check if file already exists
      if (fs.existsSync(filePath)) {
        logger.info(`File already exists: ${imageName}.${imageExtension}`);
        return;
      }

      // Download the image with retries
      const maxRetries = 3;
      let retryCount = 0;

      while (retryCount < maxRetries) {
        try {
          const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            headers: {
              'User-Agent': config.userAgent
            },
            timeout: 10000  // 10 second timeout
          });

          this.validateImageResponse(response);

          // Save the image
          await fs.promises.writeFile(filePath, response.data);
          logger.info(`Successfully downloaded: ${imageName}.${imageExtension} to ${accountToFetch}'s directory`);
          return;

        } catch (error) {
          retryCount++;
          if (retryCount === maxRetries) {
            throw error;
          }
          logger.warn(`Retry ${retryCount}/${maxRetries} for ${imageName}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }
    } catch (error) {
      if (error.response) {
        logger.error(`Download failed with status ${error.response.status}: ${imageUrl}`);
      } else {
        logger.error(`Download failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Cleans up resources
   * @param {Object} page - Puppeteer page object
   */
  cleanup(page) {
    if (page) {
      page.removeAllListeners('response');
    }
    this.downloadQueue.clear();
    this.currentUsername = null;
  }
}

export default new ImageService();
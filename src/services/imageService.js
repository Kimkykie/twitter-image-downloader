// src/services/imageService.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import downloadTracker from '../utils/downloadTracker.js';
import { createImageDirectory } from '../utils/fileSystem.js';

/**
 * @typedef {Object} ImageInfo
 * @property {string} filename - The filename of the image
 * @property {string} url - The original URL of the image
 */

/**
 * @typedef {Object} RateLimiter
 * @property {number} lastDownload - Timestamp of the last download
 * @property {number} minDelay - Minimum delay between downloads in milliseconds
 */

/**
 * Service for managing image downloads from Twitter
 * @class ImageService
 */
class ImageService {
  /**
   * Creates a new ImageService instance
   */
  constructor() {
    /** @type {Set<string>} Set of URLs currently being downloaded */
    this.downloadQueue = new Set();
    /** @type {string|null} Currently processing Twitter username */
    this.currentUsername = null;
    /** @type {RateLimiter} Rate limiting configuration */
    this.rateLimiter = {
      lastDownload: 0,
      minDelay: 500
    };
  }

  /**
   * Sets up image download listeners on the page
   * @param {import('puppeteer').Page} page - Puppeteer page object
   * @param {string} accountToFetch - Twitter username to fetch images from
   */
  setupImageDownloadListeners(page, accountToFetch) {
    page.removeAllListeners('response');
    this.currentUsername = accountToFetch;
    downloadTracker.reset();

    page.on("response", async (response) => {
      const url = response.url();
      if (response.request().resourceType() === "image" && url.match(config.regex.imageUrl)) {
        const cleanurl = url.replace(config.regex.urlCleaner, "&name=large");

        try {
          const imageDetails = cleanurl.match(config.regex.imageDetails);
          if (imageDetails) {
            const imageName = imageDetails[1];
            const imageExtension = imageDetails[2];
            await this.queueImageDownload(cleanurl, this.currentUsername, {
              filename: `${imageName}.${imageExtension}`,
              url: cleanurl
            });
          }
        } catch (error) {
          logger.error("Error processing image URL:", error);
        }
      }
    });

    logger.info(`Starting download for account: ${accountToFetch}`);
  }

  /**
   * Navigates to the media page of a Twitter account
   * @param {import('puppeteer').Page} page - Puppeteer page object
   * @param {string} accountToFetch - Twitter username to fetch images from
   * @throws {Error} If navigation fails
   */
  async navigateToMediaPage(page, accountToFetch) {
    const username = accountToFetch.replace("@", "");
    const mediaUrl = `${config.urls.base}/${username}/media`;

    try {
      await page.goto(mediaUrl, {
        waitUntil: "networkidle0",
        timeout: config.timeouts.long
      });
    } catch (error) {
      logger.error(`Failed to navigate to ${mediaUrl}:`, error);
      throw error;
    }
  }

  /**
   * Implements rate limiting for downloads
   * @private
   * @returns {Promise<void>}
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
   * @param {string} accountToFetch - Twitter username
   * @param {ImageInfo} imageInfo - Information about the image
   * @returns {Promise<void>}
   */
  async queueImageDownload(imageUrl, accountToFetch, imageInfo) {
    if (this.downloadQueue.has(imageUrl)) {
      downloadTracker.updateProgress('skipped', imageInfo);
      return;
    }

    this.downloadQueue.add(imageUrl);

    try {
      await this.rateLimit();
      await this.downloadImage(imageUrl, accountToFetch, imageInfo);
    } catch (error) {
      downloadTracker.updateProgress('failed', imageInfo);
    } finally {
      this.downloadQueue.delete(imageUrl);
    }
  }

  /**
   * Validates the response from an image download request
   * @private
   * @param {import('axios').AxiosResponse} response - Axios response object
   * @returns {boolean} True if response is valid
   * @throws {Error} If response is invalid
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
   * @param {string} accountToFetch - Twitter username
   * @param {ImageInfo} imageInfo - Information about the image
   * @returns {Promise<void>}
   * @throws {Error} If download fails
   */
  async downloadImage(imageUrl, accountToFetch, imageInfo) {
    try {
      const imageDetails = imageUrl.match(config.regex.imageDetails);
      if (!imageDetails) {
        throw new Error('Invalid image URL format');
      }

      const [, imageName, imageExtension] = imageDetails;
      const dirPath = path.join('./images', accountToFetch);

      if (!fs.existsSync(dirPath)) {
        createImageDirectory(accountToFetch);
      }

      const filePath = path.join(dirPath, `${imageName}.${imageExtension}`);

      if (fs.existsSync(filePath)) {
        downloadTracker.updateProgress('skipped', imageInfo);
        return;
      }

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
            timeout: 10000
          });

          this.validateImageResponse(response);
          await fs.promises.writeFile(filePath, response.data);
          downloadTracker.updateProgress('downloaded', imageInfo);
          return;

        } catch (error) {
          retryCount++;
          if (retryCount === maxRetries) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }
    } catch (error) {
      downloadTracker.updateProgress('failed', imageInfo);
      throw error;
    }
  }

  /**
   * Cleans up resources and generates final reports
   * @param {import('puppeteer').Page} page - Puppeteer page object
   * @returns {Promise<void>}
   */
  async cleanup(page) {
    if (page) {
      page.removeAllListeners('response');
    }
    this.downloadQueue.clear();

    // Add spacing before summary
    process.stdout.write('\n');

    // Print final summary and export CSV
    downloadTracker.printSummary();
    await downloadTracker.exportToCsv(this.currentUsername);

    // Add spacing after summary
    process.stdout.write('\n');

    this.currentUsername = null;
  }
}

export default new ImageService();
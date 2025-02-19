// src/services/browserService.js
import puppeteer from 'puppeteer';
import config from '../config/config.js';
import logger from '../utils/logger.js';

/**
 * Manages browser-related operations.
 */
class BrowserService {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  /**
   * Launches a new browser instance.
   * @returns {Promise<Object>} The browser instance.
   */
  async launchBrowser() {
    try {
      if (!this.browser || !this.browser.isConnected()) {
        this.browser = await puppeteer.launch({
          headless: config.puppeteer.headless,
          args: config.puppeteer.args,
          slowMo: config.puppeteer.slowMo,
        });
        logger.info('Browser launched successfully');
      }
      return this.browser;
    } catch (error) {
      logger.error('Failed to launch browser:', error);
      throw error;
    }
  }

  /**
   * Creates a new page and sets up necessary configurations.
   * @param {Object} browser - The browser instance.
   * @returns {Promise<Object>} The configured page object.
   */
  async setupPage(browser) {
    try {
      if (!this.page || this.page.isClosed()) {
        this.page = await browser.newPage();
        await this.page.setViewport(config.viewport);
        await this.page.setUserAgent(config.userAgent);
        await this.page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
        });
        logger.info('Page setup complete');
      }
      return this.page;
    } catch (error) {
      logger.error('Failed to setup page:', error);
      throw error;
    }
  }

  /**
   * Automatically scrolls the page to load all media.
   * @param {Object} page - The Puppeteer page object.
   * @returns {Promise<void>}
   */
  async autoScroll(page) {
    try {
      const result = await page.evaluate(async () => {
        return await new Promise((resolve) => {
          let totalHeight = 0;
          let distance = 800;
          let timer = null;
          let noNewContentCount = 0;
          const maxNoNewContent = 5;

          const scroll = async () => {
            const previousHeight = document.documentElement.scrollHeight;

            window.scrollBy(0, distance);
            await new Promise(r => setTimeout(r, 1000));

            totalHeight += distance;
            const currentHeight = document.documentElement.scrollHeight;

            // Check if we've reached the bottom
            if (currentHeight === previousHeight) {
              noNewContentCount++;
              if (noNewContentCount >= maxNoNewContent) {
                clearInterval(timer);
                resolve({
                  success: true,
                  reason: 'Reached bottom of page',
                  totalScrolled: totalHeight
                });
                return;
              }
            } else {
              noNewContentCount = 0;
            }

            // Safety check - if we've been scrolling for too long
            if (totalHeight > 1000000) { // ~1 million pixels
              clearInterval(timer);
              resolve({
                success: false,
                reason: 'Maximum scroll height reached',
                totalScrolled: totalHeight
              });
              return;
            }
          };

          timer = setInterval(scroll, 1000);
        });
      });
      process.stdout.write('\n');
      logger.info(`Auto-scroll complete: ${result.reason}`);
      return result;

    } catch (error) {
      logger.error('Error during auto-scroll:', error);
      return {
        success: false,
        reason: 'Error during scroll: ' + error.message
      };
    }
  }

  /**
   * Cleans up browser resources
   */
  async cleanup() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.page = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        logger.info('Browser closed successfully');
      }
    } catch (error) {
      logger.error('Error during cleanup:', error);
      throw error;
    }
  }
}

export default new BrowserService();
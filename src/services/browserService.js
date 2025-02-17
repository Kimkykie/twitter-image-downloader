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
      await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
          let previousHeight = 0;
          let noChangeCount = 0;
          const maxNoChange = 10; // Stop after 10 attempts with no new content
          const scrollDelay = 1000; // 1 second between scrolls

          const scrollInterval = setInterval(async () => {
            try {
              const currentHeight = document.documentElement.scrollHeight;

              // Scroll by a reasonable amount
              window.scrollBy(0, 800);

              // Wait for potential content load
              await new Promise(r => setTimeout(r, scrollDelay));

              // Check if we've reached the bottom
              if (currentHeight === previousHeight) {
                noChangeCount++;
                if (noChangeCount >= maxNoChange) {
                  clearInterval(scrollInterval);
                  resolve();
                  return;
                }
              } else {
                // Reset counter if height changed (new content loaded)
                noChangeCount = 0;
                previousHeight = currentHeight;
              }
            } catch (error) {
              clearInterval(scrollInterval);
              reject(error);
            }
          }, scrollDelay);
        });
      });

      process.stdout.write('\n');
      logger.info('Auto-scroll complete');
    } catch (error) {
      logger.error('Error during auto-scroll:', error);
      throw error;
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
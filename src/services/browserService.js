// src/services/browserService.js
import puppeteer from 'puppeteer-extra'; // Using puppeteer-extra
import StealthPlugin from 'puppeteer-extra-plugin-stealth'; // Stealth plugin
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { setTimeout as sleep } from 'node:timers/promises';
import PagePoolManager from './pagePoolManager.js';


// Apply the stealth plugin
puppeteer.use(StealthPlugin());

/**
 * Manages browser-related operations.
 */
class BrowserService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.pagePool = null;  // For parallel processing mode
  }

  /**
   * Launches a new browser instance.
   * @returns {Promise<import('puppeteer').Browser>} The browser instance.
   */
  async launchBrowser() {
    try {
      if (!this.browser || !this.browser.isConnected()) {
        this.browser = await puppeteer.launch({
          headless: config.puppeteer.headless,
          args: config.puppeteer.args,
          slowMo: config.puppeteer.slowMo,
          // executablePath: puppeteer.executablePath() // Explicitly set path if needed
        });
        logger.info('Browser launched successfully with stealth plugin.');
        this.browser.on('disconnected', () => {
            logger.warn('Browser disconnected.');
            this.browser = null; // Reset browser instance
            this.page = null; // Reset page instance
        });
      }
      return this.browser;
    } catch (error) {
      logger.error('Failed to launch browser:', error);
      throw error;
    }
  }

  /**
   * Creates a new page and sets up necessary configurations.
   * @param {import('puppeteer').Browser} browser - The browser instance.
   * @returns {Promise<import('puppeteer').Page>} The configured page object.
   */
  async setupPage(browser) {
    try {
      this.page = await browser.newPage();

      await this.page.setViewport({ width: config.viewport.width, height: config.viewport.height });
      await this.page.setUserAgent(config.userAgent);

      // Set additional headers to mimic a real browser
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br', // Common encoding
        'Connection': 'keep-alive',
      });

      // Evade detection for webdriver
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
        // @ts-ignore
        window.navigator.chrome = {
          runtime: {},
        };
        // @ts-ignore
        // eslint-disable-next-line
        const originalQuery = window.navigator.permissions.query;
        // @ts-ignore
        window.navigator.permissions.query = (parameters) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      });


      return this.page;
    } catch (error) {
      logger.error('Failed to setup page:', error);
      if (this.page && !this.page.isClosed()) {
          try { await this.page.close(); } catch (e) { logger.warn('Failed to close page during error handling in setupPage.')}
      }
      this.page = null;
      throw error;
    }
  }

  /**
   * Creates a page pool for parallel processing.
   * @param {number} poolSize - Number of pages in the pool (default from config)
   * @returns {Promise<PagePoolManager>} The page pool manager
   */
  async createPagePool(poolSize = config.parallelProcessing.tabCount) {
    if (!this.browser || !this.browser.isConnected()) {
      throw new Error('Browser must be launched before creating page pool');
    }

    if (this.pagePool) {
      logger.warn('Page pool already exists, cleaning up before creating new one');
      await this.pagePool.cleanup();
    }

    this.pagePool = new PagePoolManager(this.browser, poolSize);
    await this.pagePool.initialize();

    return this.pagePool;
  }

  /**
   * Gets the existing page pool.
   * @returns {PagePoolManager|null}
   */
  getPagePool() {
    return this.pagePool;
  }

  /**
   * Automatically scrolls the page to load all media.
   * @param {import('puppeteer').Page} page - The Puppeteer page object.
   * @param {object} [options] - Optional scroll parameters.
   * @param {number} [options.scrollDelayMin=1000] - Minimum delay between scrolls in ms.
   * @param {number} [options.scrollDelayMax=2000] - Maximum delay between scrolls in ms.
   * @param {number} [options.scrollDistanceMin=700] - Minimum scroll distance in pixels.
   * @param {number} [options.scrollDistanceMax=1000] - Maximum scroll distance in pixels.
   * @param {number} [options.maxScrolls=200] - Maximum number of scroll attempts.
   * @returns {Promise<{success: boolean, reason: string, totalScrolled: number}>}
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
    // Clean up page pool first
    if (this.pagePool) {
      try {
        await this.pagePool.cleanup();
        logger.info('Page pool cleaned up successfully.');
      } catch (error) {
        logger.warn(`Error cleaning up page pool: ${error.message}`);
      } finally {
        this.pagePool = null;
      }
    }

    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        logger.info('Page closed successfully.');
        this.page = null;
      }
    } catch (error) {
        logger.warn(`Could not close page during cleanup: ${error.message}`);
    } finally {
        this.page = null; // Ensure page is nullified
    }

    try {
      if (this.browser && this.browser.isConnected()) {
        await this.browser.close();
        logger.info('Browser closed successfully.');
      }
    } catch (error) {
      logger.error(`Error closing browser during cleanup: ${error.message}`);
    } finally {
        this.browser = null; // Ensure browser is nullified
    }
  }
}

export default new BrowserService();

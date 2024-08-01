import puppeteer from 'puppeteer';
import config from '../config/config.js';
import logger from '../utils/logger.js';

/**
 * Manages browser-related operations.
 */
class BrowserService {
  /**
   * Launches a new browser instance.
   * @returns {Promise<Object>} The browser instance.
   */
  async launchBrowser() {
    try {
      const browser = await puppeteer.launch({
        headless: config.puppeteer.headless,
        args: config.puppeteer.args,
        slowMo: config.puppeteer.slowMo,
      });
      logger.info('Browser launched successfully');
      return browser;
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
    const page = await browser.newPage();
    await page.setViewport(config.viewport);
    await page.setUserAgent(config.userAgent);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });
    logger.info('Page setup complete');
    return page;
  }

  /**
   * Automatically scrolls the page to load all media.
   * @param {Object} page - The Puppeteer page object.
   * @returns {Promise<void>}
   */
  async autoScroll(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });
    logger.info('Auto-scroll complete');
  }
}

export default new BrowserService();
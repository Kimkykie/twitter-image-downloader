// src/services/browserService.js

import config from '../config/config.js';
import logger from '../utils/logger.js';
import browserManager from './browserManager.js';

class BrowserService {
  constructor() {
    this.activePage = null;
  }

  /**
   * Get or create a browser instance
   */
  async getBrowser() {
    return browserManager.getBrowser();
  }

  /**
   * Creates a new page or returns existing one
   */
  async getPage() {
    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }

    const browser = await this.getBrowser();
    this.activePage = await browser.newPage();
    await this.configurePage(this.activePage);
    return this.activePage;
  }

  /**
   * Configure page settings
   */
  async configurePage(page) {
    await page.setViewport(config.viewport);
    await page.setUserAgent(config.userAgent);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br'
    });

    // Enable request interception only for non-essential resources
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      // Only abort analytics, ads, and other non-essential resources
      if (['stylesheet', 'font', 'media', 'websocket', 'other'].includes(resourceType)) {
        request.abort();
      } else if (resourceType === 'image') {
        // Allow images but check if they're from Twitter's media CDN
        const url = request.url();
        if (url.includes('pbs.twimg.com/media')) {
          request.continue();
        } else {
          request.abort();
        }
      } else {
        request.continue();
      }
    });

    logger.info('Page configured successfully');
  }

  /**
   * Automatically scrolls the page to load all media
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

          // Check if we've reached the bottom
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });

    // Wait a bit after scrolling for images to load
    await page.waitForTimeout(2000);
    logger.info('Auto-scroll complete');
  }

  /**
   * Clean up resources if needed
   */
  async cleanup() {
    if (this.activePage && !this.activePage.isClosed()) {
      await this.activePage.close();
      this.activePage = null;
    }
  }
}

export default new BrowserService();
// src/services/pagePoolManager.js
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { PageCrashedError, BrowserDisconnectedError } from '../utils/errors.js';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Manages a pool of browser pages for parallel processing.
 * Each page is configured with the same stealth settings.
 */
class PagePoolManager {
  /**
   * Creates a new PagePoolManager.
   * @param {import('puppeteer').Browser} browser - The browser instance
   * @param {number} poolSize - Number of pages in the pool
   */
  constructor(browser, poolSize = 3) {
    this.browser = browser;
    this.poolSize = poolSize;
    this.pages = [];           // Array of page objects
    this.pageStatus = [];      // 'idle' | 'busy' | 'crashed'
    this.pageIds = [];         // Unique IDs for logging
    this.waiting = [];         // Queue of resolve functions waiting for a page
    this.initialized = false;
  }

  /**
   * Initializes all pages in the pool.
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      logger.warn('PagePoolManager already initialized');
      return;
    }

    logger.info(`Initializing page pool with ${this.poolSize} pages...`);

    for (let i = 0; i < this.poolSize; i++) {
      try {
        const page = await this.createPage(i);
        this.pages.push(page);
        this.pageStatus.push('idle');
        this.pageIds.push(`page-${i + 1}`);
        logger.info(`Page ${i + 1}/${this.poolSize} created and configured`);
      } catch (error) {
        logger.error(`Failed to create page ${i + 1}: ${error.message}`);
        // Continue creating other pages
        this.pages.push(null);
        this.pageStatus.push('crashed');
        this.pageIds.push(`page-${i + 1}`);
      }
    }

    const activePages = this.pages.filter(p => p !== null).length;
    if (activePages === 0) {
      throw new Error('Failed to create any pages in the pool');
    }

    logger.info(`Page pool initialized with ${activePages}/${this.poolSize} active pages`);
    this.initialized = true;
  }

  /**
   * Creates and configures a new page with stealth settings.
   * @param {number} index - Page index for logging
   * @returns {Promise<import('puppeteer').Page>}
   */
  async createPage(index) {
    const page = await this.browser.newPage();

    // Apply the same configuration as browserService.setupPage()
    await page.setViewport({
      width: config.viewport.width,
      height: config.viewport.height
    });

    await page.setUserAgent(config.userAgent);

    // Set additional headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    });

    // Evade webdriver detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      // @ts-ignore
      window.navigator.chrome = {
        runtime: {},
      };
      // @ts-ignore
      const originalQuery = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });

    // Handle page crashes
    page.on('error', (error) => {
      logger.error(`Page ${index + 1} error: ${error.message}`);
      this.handlePageError(index);
    });

    page.on('close', () => {
      logger.warn(`Page ${index + 1} was closed`);
      this.handlePageClosed(index);
    });

    return page;
  }

  /**
   * Handles a page error event.
   * @param {number} index - Page index
   */
  handlePageError(index) {
    this.pageStatus[index] = 'crashed';
    this.pages[index] = null;
  }

  /**
   * Handles a page close event.
   * @param {number} index - Page index
   */
  handlePageClosed(index) {
    if (this.pageStatus[index] !== 'crashed') {
      this.pageStatus[index] = 'crashed';
      this.pages[index] = null;
    }
  }

  /**
   * Acquires an idle page from the pool.
   * If no pages are available, waits until one becomes available.
   * @returns {Promise<{page: import('puppeteer').Page, pageId: string, pageIndex: number, release: Function}>}
   */
  async acquirePage() {
    if (!this.browser.isConnected()) {
      throw new BrowserDisconnectedError('Browser is disconnected');
    }

    // Try to find an idle page
    for (let i = 0; i < this.poolSize; i++) {
      if (this.pageStatus[i] === 'idle' && this.pages[i] !== null) {
        this.pageStatus[i] = 'busy';
        return {
          page: this.pages[i],
          pageId: this.pageIds[i],
          pageIndex: i,
          release: () => this.releasePage(i)
        };
      }
    }

    // Try to recreate crashed pages
    for (let i = 0; i < this.poolSize; i++) {
      if (this.pageStatus[i] === 'crashed') {
        try {
          logger.info(`Recreating crashed page ${i + 1}...`);
          this.pages[i] = await this.createPage(i);
          this.pageStatus[i] = 'busy';
          return {
            page: this.pages[i],
            pageId: this.pageIds[i],
            pageIndex: i,
            release: () => this.releasePage(i)
          };
        } catch (error) {
          logger.error(`Failed to recreate page ${i + 1}: ${error.message}`);
        }
      }
    }

    // No pages available, wait for one to be released
    logger.debug('All pages busy, waiting for one to become available...');
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /**
   * Releases a page back to the pool.
   * @param {number} pageIndex - Index of the page to release
   */
  releasePage(pageIndex) {
    if (pageIndex < 0 || pageIndex >= this.poolSize) {
      logger.warn(`Invalid page index: ${pageIndex}`);
      return;
    }

    // Check if page is still valid
    if (this.pages[pageIndex] && !this.pages[pageIndex].isClosed()) {
      this.pageStatus[pageIndex] = 'idle';

      // If someone is waiting for a page, give them this one
      if (this.waiting.length > 0) {
        const resolve = this.waiting.shift();
        this.pageStatus[pageIndex] = 'busy';
        resolve({
          page: this.pages[pageIndex],
          pageId: this.pageIds[pageIndex],
          pageIndex: pageIndex,
          release: () => this.releasePage(pageIndex)
        });
      }
    } else {
      // Page is no longer valid
      this.pageStatus[pageIndex] = 'crashed';
      this.pages[pageIndex] = null;

      // Try to satisfy waiting callers with recreated pages
      this.satisfyWaiting();
    }
  }

  /**
   * Tries to satisfy waiting callers with available or recreated pages.
   */
  async satisfyWaiting() {
    while (this.waiting.length > 0) {
      // Try to find or recreate a page
      for (let i = 0; i < this.poolSize; i++) {
        if (this.pageStatus[i] === 'idle' && this.pages[i] !== null) {
          const resolve = this.waiting.shift();
          this.pageStatus[i] = 'busy';
          resolve({
            page: this.pages[i],
            pageId: this.pageIds[i],
            pageIndex: i,
            release: () => this.releasePage(i)
          });
          break;
        }

        if (this.pageStatus[i] === 'crashed') {
          try {
            this.pages[i] = await this.createPage(i);
            const resolve = this.waiting.shift();
            this.pageStatus[i] = 'busy';
            resolve({
              page: this.pages[i],
              pageId: this.pageIds[i],
              pageIndex: i,
              release: () => this.releasePage(i)
            });
            break;
          } catch (error) {
            logger.error(`Failed to recreate page for waiting caller: ${error.message}`);
          }
        }
      }

      // If we couldn't satisfy anyone, break
      const busyCount = this.pageStatus.filter(s => s === 'busy').length;
      if (busyCount >= this.poolSize) {
        break;
      }
    }
  }

  /**
   * Handles a crashed page - marks it and tries to recreate.
   * @param {number} pageIndex - Index of the crashed page
   * @returns {Promise<import('puppeteer').Page|null>}
   */
  async handlePageCrash(pageIndex) {
    logger.warn(`Handling crash for page ${pageIndex + 1}`);

    // Close the crashed page if it's still around
    if (this.pages[pageIndex]) {
      try {
        await this.pages[pageIndex].close();
      } catch (e) {
        // Ignore close errors
      }
    }

    this.pages[pageIndex] = null;
    this.pageStatus[pageIndex] = 'crashed';

    // Try to recreate
    try {
      this.pages[pageIndex] = await this.createPage(pageIndex);
      this.pageStatus[pageIndex] = 'idle';
      logger.info(`Page ${pageIndex + 1} recreated successfully`);
      return this.pages[pageIndex];
    } catch (error) {
      logger.error(`Failed to recreate page ${pageIndex + 1}: ${error.message}`);
      return null;
    }
  }

  /**
   * Gets the status of all pages.
   * @returns {Object} Pool status
   */
  getStatus() {
    const active = this.pageStatus.filter(s => s === 'idle' || s === 'busy').length;
    const idle = this.pageStatus.filter(s => s === 'idle').length;
    const busy = this.pageStatus.filter(s => s === 'busy').length;
    const crashed = this.pageStatus.filter(s => s === 'crashed').length;
    const waiting = this.waiting.length;

    return {
      total: this.poolSize,
      active,
      idle,
      busy,
      crashed,
      waiting
    };
  }

  /**
   * Cleans up all pages in the pool.
   * @returns {Promise<void>}
   */
  async cleanup() {
    logger.info('Cleaning up page pool...');

    // Reject any waiting requests
    while (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      resolve(null); // They should handle null
    }

    // Close all pages
    for (let i = 0; i < this.poolSize; i++) {
      if (this.pages[i] && !this.pages[i].isClosed()) {
        try {
          await this.pages[i].close();
          logger.debug(`Closed page ${i + 1}`);
        } catch (error) {
          logger.warn(`Error closing page ${i + 1}: ${error.message}`);
        }
      }
      this.pages[i] = null;
      this.pageStatus[i] = 'crashed';
    }

    this.initialized = false;
    logger.info('Page pool cleaned up');
  }
}

export default PagePoolManager;

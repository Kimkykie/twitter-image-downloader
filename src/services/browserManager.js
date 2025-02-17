// src/services/browserManager.js
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import config from '../config/config.js';
import logger from '../utils/logger.js';

class BrowserManager {
  constructor() {
    this.browser = null;
    this.activePage = null;
    this.userDataDir = path.join(process.cwd(), 'browser_data');
    this.cookiesPath = path.join(this.userDataDir, 'cookies.json');
  }

  async launchBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch({
        headless: config.puppeteer.headless,
        userDataDir: this.userDataDir,
        args: config.puppeteer.args,
        slowMo: config.puppeteer.slowMo,
        defaultViewport: config.viewport
      });

      this.browser.on('disconnected', () => {
        logger.info('Browser disconnected');
        this.browser = null;
        this.activePage = null;
      });

      logger.info('Browser launched successfully');
    }
    return this.browser;
  }

  async getPage() {
    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }

    const browser = await this.launchBrowser();
    this.activePage = await browser.newPage();
    await this.configurePage(this.activePage);
    return this.activePage;
  }

  async configurePage(page) {
    await page.setViewport(config.viewport);
    await page.setUserAgent(config.userAgent);
    await page.setRequestInterception(true);

    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['stylesheet', 'font', 'media', 'websocket', 'other'].includes(resourceType)) {
        request.abort();
      } else if (resourceType === 'image') {
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
    return page;
  }

  /**
  * Check if user is already logged in
  * @param {Object} page - Puppeteer page object
  * @returns {Promise<boolean>} - True if logged in, false otherwise
  */
  async isLoggedIn(page) {
    try {
      // Use less strict wait conditions and shorter timeout
      await page.goto(config.urls.base, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });

      // Add a small delay for dynamic content
      await page.waitForTimeout(2000);

      // First check if we're redirected to login page
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
        logger.info('Redirected to login page');
        return false;
      }

      try {
        const loginSelector = '[data-testid="login-button"], [data-testid="LoginForm_Login_Button"], [data-testid="SignupButton"]';
        const profileSelector = '[data-testid="AppTabBar_Profile_Link"], [data-testid="SideNav_AccountSwitcher_Button"]';

        // Evaluate directly in the page context
        const isLoggedIn = await page.evaluate((selectors) => {
          const hasLoginButton = !!document.querySelector(selectors.login);
          const hasProfileButton = !!document.querySelector(selectors.profile);
          return hasProfileButton && !hasLoginButton;
        }, {
          login: loginSelector,
          profile: profileSelector
        });

        logger.info(`Session check result: ${isLoggedIn ? 'Logged in' : 'Not logged in'}`);
        return isLoggedIn;

      } catch (timeoutError) {
        logger.warn('Error checking login elements, assuming not logged in:', timeoutError);
        return false;
      }
    } catch (error) {
      logger.error('Error checking login status:', error.message);
      // If we get a timeout or network error, assume we need to log in
      return false;
    } finally {
      // Ensure we're not hanging onto any resources
      try {
        await page.evaluate(() => {
          window.stop();
        }).catch(() => { });
      } catch (e) {
        // Ignore any errors in cleanup
      }
    }
  }

  async saveCookies(page) {
    try {
      const cookies = await page.cookies();
      await fs.promises.writeFile(
        this.cookiesPath,
        JSON.stringify(cookies, null, 2)
      );
      logger.info('Cookies saved successfully');
    } catch (error) {
      logger.error('Error saving cookies:', error);
    }
  }

  async loadCookies(page) {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookiesString = await fs.promises.readFile(this.cookiesPath, 'utf8');
        const cookies = JSON.parse(cookiesString);
        if (Array.isArray(cookies) && cookies.length > 0) {
          await page.setCookie(...cookies);
          logger.info('Cookies loaded successfully');
          return true;
        }
      }
      return false;
    } catch (error) {
      logger.error('Error loading cookies:', error);
      return false;
    }
  }

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
    await page.waitForTimeout(2000);

    process.stdout.write('\n');
    logger.info('Page scrolling completed');
  }

  async cleanup() {
    if (this.activePage && !this.activePage.isClosed()) {
      await this.activePage.close();
      this.activePage = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Browser closed successfully');
    }
  }
}

export default new BrowserManager();
// src/services/browserManager.js

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import config from '../config/config.js';
import logger from '../utils/logger.js';

class BrowserManager {
  constructor() {
    this.browser = null;
    this.userDataDir = path.join(process.cwd(), 'browser_data');
    this.cookiesPath = path.join(this.userDataDir, 'cookies.json');
    this.isFirstRun = !fs.existsSync(this.userDataDir);
  }

  /**
   * Initialize browser manager and create necessary directories
   */
  async init() {
    try {
      if (this.isFirstRun) {
        fs.mkdirSync(this.userDataDir, { recursive: true });
        logger.info('Created browser data directory');
      }
    } catch (error) {
      logger.error('Error initializing browser manager:', error);
      throw error;
    }
  }

  /**
   * Launch browser with persistent data directory
   */
  async launchBrowser() {
    try {
      if (!this.browser || !this.browser.isConnected()) {
        this.browser = await puppeteer.launch({
          headless: config.puppeteer.headless,
          userDataDir: this.userDataDir,
          args: [
            ...config.puppeteer.args,
            `--user-data-dir=${this.userDataDir}`,
          ],
          slowMo: config.puppeteer.slowMo || 0,
          defaultViewport: {
            width: config.viewport.width,
            height: config.viewport.height
          }
        });

        // Handle browser disconnection
        this.browser.on('disconnected', () => {
          logger.info('Browser disconnected');
          this.browser = null;
        });

        logger.info('Browser launched successfully with persistent data');
      }
      return this.browser;
    } catch (error) {
      logger.error('Failed to launch browser:', error);
      throw error;
    }
  }

  /**
   * Check if user is already logged in
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
        logger.warn('Error checking login elements, assuming not logged in');
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
        }).catch(() => {});
      } catch (e) {
        // Ignore any errors in cleanup
      }
    }
  }

  /**
   * Save cookies for future sessions
   */
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
      throw error;
    }
  }

  /**
   * Load saved cookies into the page
   */
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
      logger.info('No valid cookies found');
      return false;
    } catch (error) {
      logger.error('Error loading cookies:', error);
      return false;
    }
  }

  /**
   * Get existing browser instance or create new one
   */
  async getBrowser() {
    if (!this.browser) {
      await this.launchBrowser();
    }
    return this.browser;
  }

  /**
   * Clean up browser data if needed
   */
  async cleanup() {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        await fs.promises.unlink(this.cookiesPath);
        logger.info('Cookies file deleted');
      }

      // Attempt to remove the entire browser data directory
      if (fs.existsSync(this.userDataDir)) {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
        logger.info('Browser data directory cleaned up');
      }
    } catch (error) {
      logger.error('Error cleaning up browser data:', error);
      throw error;
    }
  }

  /**
   * Gracefully close browser
   */
  async closeBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        logger.info('Browser closed successfully');
      } catch (error) {
        logger.error('Error closing browser:', error);
        throw error;
      }
    }
  }
}

export default new BrowserManager();
// src/services/authService.js
import config from '../config/config.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { setTimeout } from 'node:timers/promises';


class AuthService {
  constructor() {
    this.cookiesPath = path.join(process.cwd(), 'cookies.json');
  }

  /**
   * Check if user is logged in by looking for profile elements
   * @param {import('puppeteer').Page} page - Puppeteer page object
   */
  async isLoggedIn(page) {
    try {
      const currentUrl = page.url();

      // If already on login page, we're not logged in
      if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
        return false;
      }

      // If not on Twitter, go to home page
      if (!currentUrl.includes('twitter.com') && !currentUrl.includes('x.com')) {
        await page.goto(config.urls.base, { waitUntil: 'networkidle2' });
      }

      // Check for login status using your working selectors
      return await page.evaluate(() => {
        const loginButton = document.querySelector('[data-testid="login"]');
        const signupButton = document.querySelector('[data-testid="SignupButton"]');
        const profileLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');

        return !!profileLink && !loginButton && !signupButton;
      });
    } catch (error) {
      logger.error('Error checking login status:', error);
      return false;
    }
  }

  /**
   * Save cookies after successful login
   * @param {import('puppeteer').Page} page - Puppeteer page object
   */
  async saveCookies(page) {
    try {
      const cookies = await page.cookies();
      await fs.promises.writeFile(this.cookiesPath, JSON.stringify(cookies, null, 2));
      logger.info('Cookies saved successfully');
    } catch (error) {
      logger.error('Failed to save cookies:', error);
    }
  }

  /**
   * Load cookies if they exist
   * @param {import('puppeteer').Page} page - Puppeteer page object
   */
  async loadCookies(page) {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookiesString = await fs.promises.readFile(this.cookiesPath, 'utf8');
        const cookies = JSON.parse(cookiesString);
        await page.setCookie(...cookies);
        logger.info('Cookies loaded successfully');
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to load cookies:', error);
      return false;
    }
  }

  /**
   * Logs in to Twitter using provided credentials.
   * @param {Object} page - The Puppeteer page object.
   * @param {string} username - The Twitter username.
   * @param {string} password - The Twitter password.
   * @returns {Promise<void>}
   */
  async loginToTwitter(page, username, password) {
    try {
      // Try to load saved cookies first
      await this.loadCookies(page);

      // Check if already logged in
      if (await this.isLoggedIn(page)) {
        logger.info('Already logged in via cookies');
        return;
      }

      // If not logged in, perform login
      await page.goto(config.urls.login, { waitUntil: 'networkidle2' });

      await page.waitForSelector(config.selectors.usernameInput);
      await page.type(config.selectors.usernameInput, username);

      const [nextButton] = await page.$$(config.selectors.nextButtonXPath);
      if (nextButton) {
        await nextButton.click();
      } else {
        throw new Error("Next button not found");
      }

      await setTimeout(config.timeouts.medium);

      // 1 minute timeout for password input in case captcha is triggered
      await page.waitForSelector(config.selectors.passwordInput, {
        timeout: 60000,
      });
      await page.type(config.selectors.passwordInput, password);

      await page.waitForSelector(config.selectors.loginButton, { visible: true });
      await page.click(config.selectors.loginButton);

      await page.waitForNavigation({ waitUntil: 'networkidle2' });

      // Verify login was successful
      if (await this.isLoggedIn(page)) {
        await this.saveCookies(page);
        logger.info('Successfully logged in to Twitter');
      } else {
        throw new Error('Login verification failed');
      }
    } catch (error) {
      logger.error('Error during login:', error);
      throw error;
    }
  }
}

export default new AuthService();
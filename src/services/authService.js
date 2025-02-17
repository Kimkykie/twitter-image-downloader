// src/services/authService.js
import config from '../config/config.js';
import browserManager from './browserManager.js';
import logger from '../utils/logger.js';

class AuthService {
  constructor() {
    this.isAuthenticating = false;
    this.MAX_RETRIES = 3;
  }

  async loginToTwitter(username, password) {
    if (this.isAuthenticating) {
      logger.warn('Authentication already in progress');
      return false;
    }

    this.isAuthenticating = true;
    let retryCount = 0;

    try {
      const page = await browserManager.getPage();

      // First check if we're already logged in
      const isLoggedIn = await browserManager.isLoggedIn(page);
      if (isLoggedIn) {
        logger.info('Already logged in');
        return true;
      }

      // Try to load saved cookies first
      await browserManager.loadCookies(page);

      // Retry login process if needed
      while (retryCount < this.MAX_RETRIES) {
        try {
          await this.executeLogin(page, username, password);
          await browserManager.saveCookies(page);
          return true;
        } catch (error) {
          retryCount++;
          logger.warn(`Login attempt ${retryCount} failed: ${error.message}`);

          if (retryCount === this.MAX_RETRIES) {
            throw error;
          }

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    } catch (error) {
      logger.error('Login failed:', error);
      return false;
    } finally {
      this.isAuthenticating = false;
    }
  }

  async executeLogin(page, username, password) {
    await page.goto(config.urls.login, { waitUntil: 'networkidle2' });

    // Username input
    await page.waitForSelector(config.selectors.usernameInput);
    await page.type(config.selectors.usernameInput, username);

    // Click next
    const [nextButton] = await page.$x(config.selectors.nextButtonXPath);
    if (!nextButton) {
      throw new Error('Next button not found');
    }
    await nextButton.click();
    await page.waitForTimeout(config.timeouts.short);

    // Password input
    await page.waitForSelector(config.selectors.passwordInput,{
      timeout: 60000 // Wait for up to 60 seconds
    });
    await page.type(config.selectors.passwordInput, password);

    // Login button
    await page.waitForSelector(config.selectors.loginButton, { visible: true });
    await page.click(config.selectors.loginButton);

    // Wait for navigation and verify login
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    const loginSuccessful = await browserManager.isLoggedIn(page);
    if (!loginSuccessful) {
      throw new Error('Login verification failed');
    }

    logger.info('Successfully logged in to Twitter');
  }
}

export default new AuthService();
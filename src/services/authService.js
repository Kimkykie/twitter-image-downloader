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
   * Types text with human-like delays between keystrokes.
   * @param {import('puppeteer').Page} page
   * @param {string} selector
   * @param {string} text
   */
  async humanType(page, selector, text) {
    await page.click(selector);
    await setTimeout(100 + Math.random() * 200);

    for (const char of text) {
      await page.type(selector, char, { delay: 50 + Math.random() * 100 });
      // Occasional longer pause (simulates thinking)
      if (Math.random() < 0.1) {
        await setTimeout(200 + Math.random() * 300);
      }
    }
  }

  /**
   * Moves mouse to element with human-like curve.
   * @param {import('puppeteer').Page} page
   * @param {string} selector
   */
  async humanClick(page, selector) {
    const element = await page.$(selector);
    if (!element) throw new Error(`Element not found: ${selector}`);

    const box = await element.boundingBox();
    if (!box) throw new Error(`Could not get bounding box for: ${selector}`);

    // Random point within the element
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);

    // Move mouse with steps
    await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) });
    await setTimeout(50 + Math.random() * 100);
    await page.mouse.click(x, y);
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
   * Load cookies if they exist (handles various export formats)
   * @param {import('puppeteer').Page} page - Puppeteer page object
   */
  async loadCookies(page) {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookiesString = await fs.promises.readFile(this.cookiesPath, 'utf8');
        let cookies = JSON.parse(cookiesString);

        // Handle different cookie export formats
        if (!Array.isArray(cookies)) {
          // Some extensions export as object with cookies property
          if (cookies.cookies) {
            cookies = cookies.cookies;
          } else {
            logger.error('Invalid cookies format - expected array');
            return false;
          }
        }

        // Normalize cookies for Puppeteer
        const normalizedCookies = cookies.map(cookie => {
          // Handle Cookie-Editor format (uses "domain" with leading dot)
          const normalized = {
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain || '.x.com',
            path: cookie.path || '/',
            secure: cookie.secure !== false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'Lax',
          };

          // Handle expiration (different formats: expirationDate, expires, expiry)
          if (cookie.expirationDate) {
            normalized.expires = cookie.expirationDate;
          } else if (cookie.expires) {
            normalized.expires = cookie.expires;
          } else if (cookie.expiry) {
            normalized.expires = cookie.expiry;
          }

          return normalized;
        }).filter(c => c.name && c.value); // Remove invalid cookies

        if (normalizedCookies.length === 0) {
          logger.error('No valid cookies found in file');
          return false;
        }

        // Check for essential cookies
        const cookieNames = normalizedCookies.map(c => c.name);
        const hasAuth = cookieNames.includes('auth_token');
        const hasCt0 = cookieNames.includes('ct0');

        if (!hasAuth) {
          logger.warn('Missing auth_token cookie - session may not work');
        }
        if (!hasCt0) {
          logger.warn('Missing ct0 cookie - some features may not work');
        }

        await page.setCookie(...normalizedCookies);
        logger.info(`Loaded ${normalizedCookies.length} cookies successfully`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to load cookies:', error.message);
      return false;
    }
  }

  /**
   * Checks for Twitter error messages on the page.
   * @param {import('puppeteer').Page} page
   * @returns {Promise<string|null>} Error message if found
   */
  async checkForLoginError(page) {
    return await page.evaluate(() => {
      // Check for various error message containers
      const errorSelectors = [
        '[data-testid="toast"]',
        '[role="alert"]',
        '.css-1dbjc4n[style*="color: rgb(244, 33, 46)"]',
        'span[class*="error"]',
      ];

      for (const selector of errorSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent) {
          const text = el.textContent.toLowerCase();
          if (text.includes('could not') || text.includes('try again') ||
              text.includes('error') || text.includes('wrong') ||
              text.includes('incorrect') || text.includes('suspended')) {
            return el.textContent;
          }
        }
      }
      return null;
    });
  }

  /**
   * Logs in to Twitter using provided credentials with human-like behavior.
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

      logger.info('Starting login process... Make sure PUPPETEER_HEADLESS=false for first login.');

      // Navigate to login page
      await page.goto(config.urls.login, { waitUntil: 'networkidle2' });

      // Random delay before starting (human would look at the page first)
      await setTimeout(1000 + Math.random() * 2000);

      // Wait for and type username with human-like behavior
      await page.waitForSelector(config.selectors.usernameInput);
      await setTimeout(500 + Math.random() * 500);
      await this.humanType(page, config.selectors.usernameInput, username);

      // Wait a bit before clicking next
      await setTimeout(500 + Math.random() * 1000);

      // Click next button
      const [nextButton] = await page.$$(config.selectors.nextButtonXPath);
      if (nextButton) {
        const box = await nextButton.boundingBox();
        if (box) {
          const x = box.x + box.width / 2 + (Math.random() * 10 - 5);
          const y = box.y + box.height / 2 + (Math.random() * 5 - 2.5);
          await page.mouse.move(x, y, { steps: 15 });
          await setTimeout(100 + Math.random() * 200);
          await page.mouse.click(x, y);
        } else {
          await nextButton.click();
        }
      } else {
        throw new Error("Next button not found");
      }

      await setTimeout(config.timeouts.medium);

      // Check for errors after username submission
      const usernameError = await this.checkForLoginError(page);
      if (usernameError) {
        logger.error(`Login error after username: ${usernameError}`);
        throw new Error(`Twitter login blocked: ${usernameError}`);
      }

      // 2 minute timeout for password input (CAPTCHA, phone verification, etc.)
      logger.info('Waiting for password field... (solve any CAPTCHA/verification if shown)');
      try {
        await page.waitForSelector(config.selectors.passwordInput, {
          timeout: 120000,
        });
      } catch (e) {
        // Check if there's a verification step (phone, email, etc.)
        const pageContent = await page.content();
        if (pageContent.includes('phone') || pageContent.includes('email') ||
            pageContent.includes('verify') || pageContent.includes('confirmation')) {
          logger.warn('Twitter is requesting additional verification. Please complete it manually.');
          logger.info('Waiting up to 3 minutes for manual verification...');
          await page.waitForSelector(config.selectors.passwordInput, { timeout: 180000 });
        } else {
          throw new Error('Password field not found - login flow may have changed or been blocked');
        }
      }

      // Human-like delay before typing password
      await setTimeout(500 + Math.random() * 1000);
      await this.humanType(page, config.selectors.passwordInput, password);

      // Check for errors
      const passwordError = await this.checkForLoginError(page);
      if (passwordError) {
        logger.error(`Login error: ${passwordError}`);
        throw new Error(`Twitter login blocked: ${passwordError}`);
      }

      // Wait before clicking login
      await setTimeout(500 + Math.random() * 1000);

      await page.waitForSelector(config.selectors.loginButton, { visible: true });
      await this.humanClick(page, config.selectors.loginButton);

      // Wait for navigation or error
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      } catch (e) {
        // Navigation might not happen if there's an error
        logger.warn('Navigation timeout - checking for errors...');
      }

      // Check for post-login errors
      await setTimeout(2000);
      const loginError = await this.checkForLoginError(page);
      if (loginError) {
        logger.error(`Login failed: ${loginError}`);
        throw new Error(`Twitter login blocked: ${loginError}`);
      }

      // Verify login was successful
      if (await this.isLoggedIn(page)) {
        await this.saveCookies(page);
        logger.info('Successfully logged in to Twitter');
      } else {
        // One more check - sometimes Twitter shows a security page
        const url = page.url();
        if (url.includes('account/access') || url.includes('login/error')) {
          throw new Error('Twitter has blocked this login attempt. Try again later or login manually in a regular browser first.');
        }
        throw new Error('Login verification failed - could not confirm logged in state');
      }
    } catch (error) {
      logger.error('Error during login:', error.message);

      // Provide helpful guidance
      if (error.message.includes('blocked') || error.message.includes('Could not')) {
        logger.info('\n=== LOGIN TROUBLESHOOTING ===');
        logger.info('1. Make sure PUPPETEER_HEADLESS=false in your .env file');
        logger.info('2. Try logging into Twitter manually in a regular browser first');
        logger.info('3. Wait 15-30 minutes before trying again');
        logger.info('4. Consider using a different IP (VPN) if issue persists');
        logger.info('5. Make sure your account is not locked/suspended');
        logger.info('=============================\n');
      }

      throw error;
    }
  }
}

export default new AuthService();
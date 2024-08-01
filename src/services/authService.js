import config from '../config/config.js';
import logger from '../utils/logger.js';

/**
 * Handles the authentication process for Twitter.
 */
class AuthService {
  /**
   * Logs in to Twitter using provided credentials.
   * @param {Object} page - The Puppeteer page object.
   * @param {string} username - The Twitter username.
   * @param {string} password - The Twitter password.
   * @returns {Promise<void>}
   */
  async loginToTwitter(page, username, password) {
    try {
      await page.goto(config.urls.login, { waitUntil: 'networkidle2' });

      await page.waitForSelector(config.selectors.usernameInput);
      await page.type(config.selectors.usernameInput, username);

      const [nextButton] = await page.$x(config.selectors.nextButtonXPath);
      if (nextButton) {
        await nextButton.click();
      } else {
        throw new Error("Next button not found");
      }

      await page.waitForTimeout(config.timeouts.medium);

      await page.waitForSelector(config.selectors.passwordInput);
      await page.type(config.selectors.passwordInput, password);

      await page.waitForSelector(config.selectors.loginButton, { visible: true });
      await page.click(config.selectors.loginButton);

      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      logger.info('Successfully logged in to Twitter');
    } catch (error) {
      logger.error('Error during login:', error);
      throw error;
    }
  }
}

export default new AuthService();
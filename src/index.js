// index.js
import Inquirer from 'inquirer';
import { setTimeout } from 'node:timers/promises';
import authService from './services/authService.js';
import browserService from './services/browserService.js';
import imageService from './services/imageService.js';
import logger from './utils/logger.js';
import config from './config/config.js';
import { createImageDirectory } from './utils/fileSystem.js';

const MAX_RETRIES = 3;

async function attemptLogin(page) {
  // First try to load cookies
  const cookiesLoaded = await authService.loadCookies(page);

  if (cookiesLoaded) {
    // Verify if cookies are still valid
    const isLoggedIn = await authService.isLoggedIn(page);
    if (isLoggedIn) {
      logger.info('Successfully logged in using saved cookies');
      return true;
    }
    logger.warn('Saved cookies are invalid');
  }

  // If we reach here, we need fresh credentials
  const credentials = await getCredentials();

  // Attempt login with retries
  for (let retries = 0; retries < MAX_RETRIES; retries++) {
    try {
      await authService.loginToTwitter(page, credentials.loginUsername, credentials.loginPassword);
      return true;
    } catch (error) {
      logger.warn(`Login attempt failed (${retries + 1}/${MAX_RETRIES})`);
      if (retries === MAX_RETRIES - 1) {
        logger.error("Max login retries reached");
        return false;
      }
      await setTimeout(config.timeouts.medium * (retries + 1));
    }
  }

  return false;
}

async function getCredentials() {
  if (config.credentials.username && config.credentials.password) {
    logger.info('Using credentials from environment variables');
    return {
      loginUsername: config.credentials.username,
      loginPassword: config.credentials.password
    };
  }

  return await Inquirer.prompt([
    {
      type: "input",
      message: "Login: Enter X Username: ",
      name: "loginUsername",
      validate: input => input.length > 0 ? true : 'Username cannot be empty'
    },
    {
      type: "password",
      message: "Enter X Password: ",
      name: "loginPassword",
      validate: input => input.length > 0 ? true : 'Password cannot be empty'
    }
  ]);
}

async function processAccount(accountToFetch, page) {
  try {
    createImageDirectory(accountToFetch);

    // Setup image download listeners
    imageService.setupImageDownloadListeners(page, accountToFetch);

    // Navigate to media page and wait for load
    await imageService.navigateToMediaPage(page, accountToFetch);
    await setTimeout(config.timeouts.medium);

    // Start scrolling with improved termination check
    let scrollResult = await browserService.autoScroll(page);
    if (!scrollResult.success) {
      logger.warn(`Auto-scroll terminated early: ${scrollResult.reason}`);
    }

    await setTimeout(config.timeouts.long);

    // Cleanup and generate reports
    await imageService.cleanup(page);

    await setTimeout(config.timeouts.long);

    return true;
  } catch (error) {
    logger.error('Error processing account:', error);
    return false;
  }
}

async function main() {
  let browser = null;
  let page = null;

  try {
    browser = await browserService.launchBrowser();
    page = await browserService.setupPage(browser);

    // First handle authentication
    const loginSuccess = await attemptLogin(page);
    if (!loginSuccess) {
      logger.error('Failed to authenticate');
      return;
    }

    // Main download loop
    let continueDownloading = true;
    while (continueDownloading) {
      const { targetUsername } = await Inquirer.prompt([{
        type: "input",
        message: "Enter the X account handle to fetch media from: ",
        name: "targetUsername",
        validate: input => {
          if (!input.length) return 'Account handle cannot be empty';
          const username = input.startsWith('@') ? input.slice(1) : input;
          if (username.length > 15) return 'Username too long';
          if (!/^[a-zA-Z0-9_]+$/.test(username)) return 'Invalid username format';
          return true;
        }
      }]);

      const success = await processAccount(targetUsername, page);

      if (!success) {
        logger.warn(`Failed to process account: ${targetUsername}`);
      }

      // Add delay before the continue prompt
      await setTimeout(config.timeouts.long);

      // Clear prompt and ask about continuing
      // console.clear();
      const { shouldContinue } = await Inquirer.prompt([{
        type: 'confirm',
        name: 'shouldContinue',
        message: 'Would you like to fetch media from another account?',
        default: false
      }]);

      continueDownloading = shouldContinue;
    }
  } catch (error) {
    logger.error('Fatal application error:', error);
  } finally {
    if (browser) {
      await browserService.cleanup();
    }
  }
}

// Handle cleanup on interrupts
process.on('SIGINT', async () => {
  logger.info('Received SIGINT. Cleaning up...');
  await browserService.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM. Cleaning up...');
  await browserService.cleanup();
  process.exit(0);
});

// Start application
main().catch(async error => {
  logger.error('Unhandled error:', error);
  await browserService.cleanup();
  process.exit(1);
});
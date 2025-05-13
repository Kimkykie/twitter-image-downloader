// index.js
import Inquirer from 'inquirer';
import { setTimeout as sleep } from 'node:timers/promises'; // Renamed for clarity
import authService from './services/authService.js';
import browserService from './services/browserService.js';
import imageService from './services/imageService.js';
import logger from './utils/logger.js';
import config from './config/config.js';
// createImageDirectory is no longer directly used here, it's called within imageService
// import { createImageDirectory } from './utils/fileSystem.js';

const MAX_LOGIN_RETRIES = 3; // Renamed for clarity

async function attemptLogin(page) {
  const cookiesLoaded = await authService.loadCookies(page);
  if (cookiesLoaded) {
    const isLoggedIn = await authService.isLoggedIn(page);
    if (isLoggedIn) {
      logger.info('Successfully logged in using saved cookies.');
      return true;
    }
    logger.warn('Saved cookies are invalid or expired. Attempting fresh login.');
  } else {
    logger.info('No saved cookies found. Proceeding with manual login.');
  }

  const credentials = await getCredentials();
  for (let retries = 0; retries < MAX_LOGIN_RETRIES; retries++) {
    try {
      await authService.loginToTwitter(page, credentials.loginUsername, credentials.loginPassword);
      return true; // Login successful
    } catch (error) {
      logger.warn(`Login attempt ${retries + 1}/${MAX_LOGIN_RETRIES} failed: ${error.message}`);
      if (retries === MAX_LOGIN_RETRIES - 1) {
        logger.error("Maximum login retries reached. Please check credentials or network.");
        return false; // Max retries reached
      }
      await sleep(config.timeouts.medium * (retries + 1)); // Exponential backoff
    }
  }
  return false; // Should not be reached if loop logic is correct
}

async function getCredentials() {
  if (config.credentials.username && config.credentials.password) {
    logger.info('Using credentials from environment variables.');
    return {
      loginUsername: config.credentials.username,
      loginPassword: config.credentials.password
    };
  }
  logger.info('Environment variables for credentials not set. Prompting user.');
  return await Inquirer.prompt([
    {
      type: "input",
      message: "Login: Enter X (Twitter) Username: ",
      name: "loginUsername",
      validate: input => input.trim().length > 0 ? true : 'Username cannot be empty.'
    },
    {
      type: "password",
      message: "Enter X (Twitter) Password: ",
      name: "loginPassword",
      mask: '*',
      validate: input => input.length > 0 ? true : 'Password cannot be empty.'
    }
  ]);
}

async function processAccount(accountToFetch, page) {
  // accountToFetch is already cleaned (no '@') when passed to this function
  try {
    // createImageDirectory is now called within imageService methods if needed.
    // The main logic is now encapsulated in fetchAllImagesForUser
    await imageService.fetchAllImagesForUser(page, accountToFetch);

    // A short delay here before prompting for the next account might be good for UX.
    await sleep(config.timeouts.medium);
    return true;
  } catch (error) {
    // Log the specific account that failed, and the error.
    logger.error(`Error processing account @${accountToFetch}: ${error.message}`, error.stack);
    // Ensure some cleanup or reset in imageService if a fatal error occurs mid-processing for an account
    // imageService.cleanup() is called at the end of fetchAllImagesForUser,
    // but if fetchAllImagesForUser itself throws an unhandled error before its own cleanup,
    // this provides an additional layer.
    if (imageService.currentUsername === accountToFetch) { // Only cleanup if it's the one being processed
        logger.warn(`Performing cleanup for @${accountToFetch} due to error during processing.`);
        await imageService.cleanup();
    }
    return false;
  }
}

async function main() {
  let browser = null;
  let page = null;

  try {
    logger.info("Application starting...");
    browser = await browserService.launchBrowser();
    page = await browserService.setupPage(browser);

    const loginSuccess = await attemptLogin(page);
    if (!loginSuccess) {
      logger.error('Failed to authenticate. Exiting application.');
      // No browser cleanup here yet, finally block will handle it.
      return; // Exit main if login fails
    }

    let continueDownloading = true;
    while (continueDownloading) {
      const { targetUsernameInput } = await Inquirer.prompt([{
        type: "input",
        message: "Enter the X account handle to fetch media from (e.g., @username or username):",
        name: "targetUsernameInput", // Changed name to avoid conflict
        validate: input => {
          const trimmedInput = input.trim();
          if (!trimmedInput.length) return 'Account handle cannot be empty.';
          const username = trimmedInput.startsWith('@') ? trimmedInput.slice(1) : trimmedInput;
          if (username.length === 0 || username.length > 15) return 'Username must be 1-15 characters long.';
          if (!/^[a-zA-Z0-9_]+$/.test(username)) return 'Invalid username format (only letters, numbers, and underscores).';
          return true;
        }
      }]);

      const cleanedUsername = targetUsernameInput.trim().startsWith('@') ? targetUsernameInput.trim().slice(1) : targetUsernameInput.trim();
      const success = await processAccount(cleanedUsername, page);

      if (!success) {
        logger.warn(`Could not complete processing for account: @${cleanedUsername}`);
      } else {
        logger.info(`Successfully processed account: @${cleanedUsername}`);
      }

      await sleep(config.timeouts.short); // Brief pause before asking to continue

      const { shouldContinue } = await Inquirer.prompt([{
        type: 'confirm',
        name: 'shouldContinue',
        message: 'Would you like to fetch media from another account?',
        default: false
      }]);
      continueDownloading = shouldContinue;
      if (!continueDownloading) {
        logger.info("User chose to stop downloading.");
      }
    }
  } catch (error) {
    // Catch any unhandled errors from the main execution block
    logger.error('Fatal application error in main:', error.message, error.stack);
  } finally {
    logger.info("Initiating application cleanup...");
    // Ensure imageService cleanup is called if a user was being processed or if an error occurred.
    // imageService.cleanup() is generally called at the end of fetchAllImagesForUser.
    // This is a safety net.
    if (imageService.currentUsername) {
        logger.warn(`Performing final cleanup for image service related to @${imageService.currentUsername} due to application exit.`);
        await imageService.cleanup(); // Ensures CSV and summary are written for the last processed user
    }

    if (browser) {
      await browserService.cleanup(); // Closes browser and page
    }
    logger.info("Application finished and resources cleaned up. Exiting.");
    process.exit(0); // Ensure the process exits cleanly
  }
}

// Graceful shutdown handlers
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  // Try to clean up image service first, as it might have pending writes (CSV)
  if (imageService.currentUsername) {
    logger.warn(`Performing image service cleanup for @${imageService.currentUsername} due to ${signal}.`);
    await imageService.cleanup();
  }
  if (browserService.browser) { // Check if browser was initialized
    await browserService.cleanup();
  }
  logger.info("Graceful shutdown complete. Exiting.");
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start application
main().catch(async error => {
  // This catch is for unhandled promise rejections from main() itself,
  // though the try/finally in main should handle most cases.
  logger.error('Unhandled promise rejection in main execution:', error.message, error.stack);
  if (imageService.currentUsername) {
    await imageService.cleanup();
  }
  if (browserService.browser) {
    await browserService.cleanup();
  }
  process.exit(1); // Exit with error code
});

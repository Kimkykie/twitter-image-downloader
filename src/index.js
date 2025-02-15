// src/index.js

import Inquirer from 'inquirer';
import authService from './services/authService.js';
import browserService from './services/browserService.js';
import imageService from './services/imageService.js';
import browserManager from './services/browserManager.js';
import logger from './utils/logger.js';
import { createImageDirectory } from './utils/fileSystem.js';

const MAX_RETRIES = 3;

/**
 * Main function to fetch Twitter images
 */
async function getTwitterImages(accountToFetch, username = null, password = null) {
  try {
    await browserManager.init();
    const page = await browserService.getPage();

    createImageDirectory(accountToFetch);
    imageService.setupImageDownloadListeners(page, accountToFetch);

    // Check if already logged in
    const isLoggedIn = await browserManager.isLoggedIn(page);

    if (!isLoggedIn) {
      // If we don't have credentials but need to login, throw an error
      if (!username || !password) {
        throw new Error('Credentials required but not provided');
      }

      logger.info('No valid session found, logging in...');
      for (let retries = 0; retries < MAX_RETRIES; retries++) {
        try {
          await authService.loginToTwitter(page, username, password);
          await browserManager.saveCookies(page);
          break;
        } catch (error) {
          logger.warn(`Retrying login (${retries + 1}/${MAX_RETRIES}): ${error.message}`);
          if (retries === MAX_RETRIES - 1) {
            logger.error("Max retries reached. Exiting...");
            throw new Error('Failed to login after maximum retries');
          }
        }
      }
    } else {
      logger.info('Using existing session');
    }

    await imageService.navigateToMediaPage(page, accountToFetch);
    await browserService.autoScroll(page);

    // Don't close the browser, just close the page
    if (page && !page.isClosed()) {
      await page.close();
    }

    logger.info("Download Complete");
  } catch (error) {
    logger.error('Error in getTwitterImages:', error);
    throw error;
  }
}

/**
 * Cleanup function for graceful shutdown
 */
async function cleanup() {
  try {
    await browserManager.closeBrowser();
    process.exit(0);
  } catch (error) {
    logger.error('Error during cleanup:', error);
    process.exit(1);
  }
}

// Handle cleanup on process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

/**
 * Main prompt flow
 */
async function promptUser() {
  try {
    const page = await browserService.getPage();
    const isLoggedIn = await browserManager.isLoggedIn(page);

    let credentials = {};

    if (!isLoggedIn) {
      credentials = await Inquirer.prompt([
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

    const targetAccount = await Inquirer.prompt([
      {
        type: "input",
        message: "Enter the X account handle to fetch media from: ",
        name: "targetUsername",
        validate: input => input.length > 0 ? true : 'Account handle cannot be empty'
      }
    ]);

    if (isLoggedIn) {
      await getTwitterImages(targetAccount.targetUsername);
    } else {
      await getTwitterImages(
        targetAccount.targetUsername,
        credentials.loginUsername,
        credentials.loginPassword
      );
    }

    // Ask if user wants to fetch more accounts
    const { fetchMore } = await Inquirer.prompt([
      {
        type: 'confirm',
        name: 'fetchMore',
        message: 'Would you like to fetch media from another account?',
        default: false
      }
    ]);

    if (fetchMore) {
      await promptUser();
    } else {
      await cleanup();
    }
  } catch (error) {
    logger.error('Error in prompt flow:', error);
    await cleanup();
  }
}

// Start the application
promptUser().catch(error => {
  logger.error('Application error:', error);
  cleanup();
});
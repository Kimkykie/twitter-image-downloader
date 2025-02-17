// src/index.js
import Inquirer from 'inquirer';
import authService from './services/authService.js';
import browserService from './services/browserService.js';
import imageService from './services/imageService.js';
import logger from './utils/logger.js';
import config from './config/config.js';
import { createImageDirectory } from './utils/fileSystem.js';

const MAX_RETRIES = 3;

/**
 * Gets credentials from env or prompts user
 */
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

/**
 * Main function to fetch Twitter images.
 */
async function getTwitterImages(accountToFetch, username, password, browser, page) {
  try {
    createImageDirectory(accountToFetch);

    // Login with retries
    for (let retries = 0; retries < MAX_RETRIES; retries++) {
      try {
        await authService.loginToTwitter(page, username, password);
        break;
      } catch (error) {
        logger.warn(`Retrying login (${retries + 1}/${MAX_RETRIES})`);
        if (retries === MAX_RETRIES - 1) {
          logger.error("Max retries reached. Exiting...");
          return false;
        }
      }
    }

    // Setup listeners after successful login
    imageService.setupImageDownloadListeners(page, accountToFetch);

    // Navigate to media page and wait for load
    await imageService.navigateToMediaPage(page, accountToFetch);

    // Wait for initial media content to load
    await page.waitForTimeout(3000);

    // Start scrolling
    await browserService.autoScroll(page);

    // Give time for any pending downloads to complete
    await new Promise(resolve => setTimeout(resolve, 5000));


    return true;
  } catch (error) {
    logger.error('Error in download process:', error);
    return false;
  }
}

async function main() {
  let browser = null;
  let page = null;

  try {
    // Initialize browser once
    browser = await browserService.launchBrowser();
    page = await browserService.setupPage(browser);

    // Get credentials first
    const credentials = await getCredentials();

    // Setup for continuous downloads
    let continueDownloading = true;
    while (continueDownloading) {
      const { targetUsername } = await Inquirer.prompt([
        {
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
        }
      ]);

      console.log('\nStarting download process...\n');

      const success = await getTwitterImages(
        targetUsername,
        credentials.loginUsername,
        credentials.loginPassword,
        browser,
        page
      );

      if (!success) {
        logger.warn(`Failed to complete download for ${targetUsername}`);
      }

      // Add delay before the continue prompt
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Ask about continuing
      const { continue: shouldContinue } = await Inquirer.prompt([
        {
          type: 'confirm',
          name: 'continue',
          message: 'Would you like to fetch media from another account?',
          default: false
        }
      ]);

      continueDownloading = shouldContinue;
      if (continueDownloading) {
        console.clear();
      }
    }
  } catch (error) {
    logger.error('Fatal application error:', error);
  } finally {
    // Only cleanup when we're completely done
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
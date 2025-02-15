// src/index.js
import Inquirer from 'inquirer';
import browserManager from './services/browserManager.js';
import authService from './services/authService.js';
import imageService from './services/imageService.js';
import logger from './utils/logger.js';
import { createImageDirectory } from './utils/fileSystem.js';

async function initialize() {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await browserManager.launchBrowser();
  } catch (error) {
    logger.error('Failed to initialize browser:', error);
    process.exit(1);
  }
}

async function cleanup() {
  try {
    await browserManager.cleanup();
    process.exit(0);
  } catch (error) {
    logger.error('Error during cleanup:', error);
    process.exit(1);
  }
}

async function handleAuth(credentials) {
  try {
    const isAuthenticated = await authService.loginToTwitter(
      credentials.loginUsername,
      credentials.loginPassword
    );

    if (!isAuthenticated) {
      throw new Error('Authentication failed');
    }
    return true;
  } catch (error) {
    logger.error('Authentication error:', error);
    return false;
  }
}

async function handleMediaDownload(targetUsername) {
  try {
    // Remove @ if present for directory creation
    const cleanUsername = targetUsername.replace('@', '');
    // Create a new directory for this account
    createImageDirectory(cleanUsername);

    const page = await browserManager.getPage();

    // Setup listeners with clean username
    imageService.setupImageDownloadListeners(page, cleanUsername);

    // Navigate and scroll
    await imageService.navigateToMediaPage(page, cleanUsername);
    await browserManager.autoScroll(page);

    // Give time for any pending downloads to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    logger.info('Media download completed for:', cleanUsername);
    return true;
  } catch (error) {
    logger.error(`Failed to download media for ${targetUsername}:`, error);
    return false;
  }
}

async function promptUser() {
  try {
    const page = await browserManager.getPage();
    const isLoggedIn = await browserManager.isLoggedIn(page);

    // Handle authentication if needed
    if (!isLoggedIn) {
      const credentials = await Inquirer.prompt([
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

      const authSuccess = await handleAuth(credentials);
      if (!authSuccess) {
        logger.error('Failed to authenticate. Exiting...');
        await cleanup();
        return;
      }
    }

    // Media download loop
    let continueDownloading = true;
    while (continueDownloading) {
      const { targetUsername } = await Inquirer.prompt([
        {
          type: "input",
          message: "Enter the X account handle to fetch media from: ",
          name: "targetUsername",
          validate: input => {
            if (!input.length) return 'Account handle cannot be empty';
            // Remove @ if present for validation
            const username = input.startsWith('@') ? input.slice(1) : input;
            if (username.length > 15) return 'Username too long';
            if (!/^[a-zA-Z0-9_]+$/.test(username)) return 'Invalid username format';
            return true;
          }
        }
      ]);

      const downloadSuccess = await handleMediaDownload(targetUsername);
      if (!downloadSuccess) {
        logger.warn(`Failed to complete download for ${targetUsername}`);
      }

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
    }
  } catch (error) {
    logger.error('Error in application flow:', error);
  } finally {
    await cleanup();
  }
}

async function main() {
  try {
    await initialize();
    await promptUser();
  } catch (error) {
    logger.error('Fatal application error:', error);
    await cleanup();
  }
}

// Start application
main().catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
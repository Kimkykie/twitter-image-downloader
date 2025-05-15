// index.js
import Inquirer from 'inquirer';
import { setTimeout as sleep } from 'node:timers/promises';
import authService from './services/authService.js';
import browserService from './services/browserService.js';
import imageService from './services/imageService.js';
import logger from './utils/logger.js';
import config from './config/config.js';
import fs from 'fs';
import path from 'path';

const MAX_LOGIN_RETRIES = 3;

async function attemptLogin(page) {
  const cookiesLoaded = await authService.loadCookies(page);
  if (cookiesLoaded) {
    logger.info('Attempting to navigate to base URL to verify session...');
    try {
      await page.goto(config.urls.base, { waitUntil: 'networkidle2', timeout: config.timeouts.navigation });
      const isLoggedIn = await authService.isLoggedIn(page);
      if (isLoggedIn) {
        logger.info('Successfully logged in using saved cookies.');
        return true;
      }
      logger.warn('Saved cookies are invalid, expired, or session check failed. Attempting fresh login.');
    } catch (navError) {
      logger.warn(`Error navigating to base URL with cookies: ${navError.message}. Proceeding with fresh login.`);
    }
  } else {
    logger.info('No saved cookies found. Proceeding with manual login.');
  }

  const credentials = await getCredentials();
  for (let retries = 0; retries < MAX_LOGIN_RETRIES; retries++) {
    try {
      await authService.loginToTwitter(page, credentials.loginUsername, credentials.loginPassword);
      const isLoggedInAfterFreshLogin = await authService.isLoggedIn(page);
      if (isLoggedInAfterFreshLogin) {
        logger.info('Fresh login successful.');
        return true;
      }
      // If loginToTwitter didn't throw but isLoggedIn is false, it's a soft failure.
      logger.warn(`Login attempt ${retries + 1}/${MAX_LOGIN_RETRIES} completed, but still not logged in.`);
      // Fall through to retry or error
    } catch (error) {
      logger.warn(`Login attempt ${retries + 1}/${MAX_LOGIN_RETRIES} failed: ${error.message}`);
    }
    if (retries < MAX_LOGIN_RETRIES - 1) {
      logger.info(`Waiting ${config.timeouts.medium / 1000}s before next login attempt.`);
      await sleep(config.timeouts.medium * (retries + 1)); // Exponential backoff might be too long here
    }
  }
  logger.error("Maximum login retries reached. Please check credentials or network.");
  return false;
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
      message: "Login: Enter X (Twitter) Username/Email: ",
      name: "loginUsername",
      validate: input => input.trim().length > 0 ? true : 'Username/Email cannot be empty.'
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
  const cleanedUsername = accountToFetch.trim().replace(/^@/, "");
  if (!cleanedUsername) {
    logger.warn("Empty username provided, skipping.");
    return false;
  }
  logger.info(`Preparing to process account: @${cleanedUsername}`);
  try {
    await imageService.fetchAllImagesForUser(page, cleanedUsername);
    logger.info(`Finished processing for account: @${cleanedUsername}`);
    // A short delay here before processing the next account (if any) or prompting.
    await sleep(config.timeouts.short);
    return true;
  } catch (error) {
    logger.error(`Critical error processing account @${cleanedUsername}: ${error.message}`, error.stack);
    // Ensure cleanup for the specific user if a major error occurs within fetchAllImagesForUser
    // imageService.cleanup() is called at the end of fetchAllImagesForUser,
    // but this is an additional safeguard.
    if (imageService.currentUsername === cleanedUsername) {
      logger.warn(`Performing emergency cleanup for @${cleanedUsername} due to error during its processing.`);
      await imageService.cleanup(); // This will write out any partial CSV for this user.
    }
    return false;
  }
}

async function getAccountList() {
  const { inputType } = await Inquirer.prompt([{
    type: 'list',
    name: 'inputType',
    message: 'How do you want to provide account names?',
    choices: [
      { name: 'Enter a single account name', value: 'single' },
      { name: 'Enter a comma-separated list of account names', value: 'list' },
      { name: 'Get list of accounts from accounts.txt (one account per line)', value: 'file' }
    ]
  }]);

  let accounts = [];

  if (inputType === 'single') {
    const { singleAccount } = await Inquirer.prompt([{
      type: "input",
      message: "Enter the X account handle (e.g., @username or username):",
      name: "singleAccount",
      validate: input => {
        const trimmedInput = input.trim().replace(/^@/, "");
        if (!trimmedInput.length) return 'Account handle cannot be empty.';
        if (trimmedInput.length > 15) return 'Username must be 1-15 characters long.';
        if (!/^[a-zA-Z0-9_]+$/.test(trimmedInput)) return 'Invalid username format.';
        return true;
      }
    }]);
    accounts.push(singleAccount.trim().replace(/^@/, ""));
  } else if (inputType === 'list') {
    const { accountListStr } = await Inquirer.prompt([{
      type: "input",
      message: "Enter comma-separated account handles (e.g., user1, @user2, user3):",
      name: "accountListStr",
      validate: input => input.trim().length > 0 ? true : 'Account list cannot be empty.'
    }]);
    accounts = accountListStr.split(',').map(acc => acc.trim().replace(/^@/, "")).filter(acc => acc.length > 0);
  } else if (inputType === 'file') {

    const filePath = path.resolve(process.cwd(), 'accounts.txt');

    if (!fs.existsSync(filePath)) {
      logger.error(`accounts.txt not found at ${filePath}`);
      return []; // Return empty if file is missing
    }

    logger.info('Reading from accounts.txt (one account name per line, without @ symbol)...');

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      accounts = fileContent
        .split(/\r?\n/)
        .map(acc => acc.trim().replace(/^@/, ""))
        .filter(acc => acc.length > 0);
    } catch (error) {
      logger.error(`Error reading file ${filePath}: ${error.message}`);
      return []; // Return empty if file error
    }
  }

  if (accounts.length === 0 && inputType !== 'file') { // For file, error is already logged
    logger.warn("No valid account names were provided.");
  } else if (accounts.length > 0) {
    logger.info(`Found ${accounts.length} accounts to process: ${accounts.join(', ')}`);
  }
  return accounts;
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
      return;
    }

    let continueDownloading = true;
    while (continueDownloading) {
      const accountsToProcess = await getAccountList();

      if (accountsToProcess.length > 0) {
        for (const account of accountsToProcess) {
          const success = await processAccount(account, page);
          if (!success) {
            logger.warn(`Could not complete processing for account: @${account}. Moving to next if available.`);
          } else {
            logger.info(`Successfully finished processing for account: @${account}.`);
          }
          // Optional: Add a longer, random delay between processing different accounts
          if (accountsToProcess.indexOf(account) < accountsToProcess.length - 1) {
            const interAccountDelay = Math.floor(Math.random() * (config.timeouts.long - config.timeouts.medium + 1)) + config.timeouts.medium;
            logger.info(`Waiting for ${interAccountDelay / 1000}s before processing the next account...`);
            await sleep(interAccountDelay);
          }
        }
        logger.info("Finished processing all accounts in the current list.");
      } else {
        logger.info("No accounts were provided or found in the list/file to process in this round.");
      }

      await sleep(config.timeouts.short);

      const { shouldContinue } = await Inquirer.prompt([{
        type: 'confirm',
        name: 'shouldContinue',
        message: 'Would you like to fetch media from another account or list of accounts?',
        default: false
      }]);
      continueDownloading = shouldContinue;
      if (!continueDownloading) {
        logger.info("User chose to stop downloading.");
      }
    }
  } catch (error) {
    logger.error('Fatal application error in main:', error.message, error.stack);
  } finally {
    logger.info("Initiating application cleanup...");
    // imageService.cleanup() is called after each user in processAccount.
    // This final cleanup is more for the browser.
    if (browserService.browser) { // Use the getter from the service
      await browserService.cleanup();
    }
    logger.info("Application finished and resources cleaned up. Exiting.");
    // process.exit(0); // Let Node.js exit naturally unless error
  }
}

// Graceful shutdown handlers
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  // Try to clean up image service first if a user was actively being processed
  // This is tricky because imageService.cleanup() is user-specific.
  // The cleanup within processAccount and the final browser cleanup should mostly cover it.
  if (imageService.currentUsername && imageService.downloadQueueSize > 0) {
    logger.warn(`Downloads were in progress for @${imageService.currentUsername}. Attempting to wait briefly...`);
    await sleep(config.timeouts.medium); // Give a moment for current downloads
  }
  // If imageService has a specific user context, it might try to save its CSV.
  if (imageService.currentUsername) {
    logger.warn(`Performing final image service cleanup for @${imageService.currentUsername} due to ${signal}.`);
    await imageService.cleanup(); // This will attempt to write CSV for the current user.
  }

  if (browserService.browser) {
    await browserService.cleanup();
  }
  logger.info("Graceful shutdown attempt complete. Exiting.");
  process.exit(0); // Force exit after cleanup attempt
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main().then(() => {
  logger.info("Main execution completed.");
  // process.exit(0); // If no errors, exit cleanly.
}).catch(async error => {
  logger.error('Unhandled promise rejection in main execution chain:', error.message, error.stack);
  // Attempt last-ditch cleanup
  if (imageService.currentUsername) {
    try { await imageService.cleanup(); } catch (e) { logger.error("Error during emergency imageService cleanup:", e); }
  }
  if (browserService.browser) {
    try { await browserService.cleanup(); } catch (e) { logger.error("Error during emergency browserService cleanup:", e); }
  }
  process.exit(1); // Exit with error code
});

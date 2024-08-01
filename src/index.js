import Inquirer from 'inquirer';
import authService from './services/authService.js';
import browserService from './services/browserService.js';
import imageService from './services/imageService.js';
import logger from './utils/logger.js';
import { createImageDirectory } from './utils/fileSystem.js';

const MAX_RETRIES = 3;

/**
 * Main function to fetch Twitter images.
 * @param {string} accountToFetch - The Twitter username to fetch images from.
 * @param {string} username - The username for login.
 * @param {string} password - The password for login.
 */
async function getTwitterImages(accountToFetch, username, password) {
  const browser = await browserService.launchBrowser();
  const page = await browserService.setupPage(browser);

  createImageDirectory(accountToFetch);
  imageService.setupImageDownloadListeners(page, accountToFetch);

  for (let retries = 0; retries < MAX_RETRIES; retries++) {
    try {
      await authService.loginToTwitter(page, username, password);
      break;
    } catch (error) {
      logger.warn(`Retrying login (${retries + 1}/${MAX_RETRIES})`);
      if (retries === MAX_RETRIES - 1) {
        logger.error("Max retries reached. Exiting...");
        await browser.close();
        return;
      }
    }
  }

  await imageService.navigateToMediaPage(page, accountToFetch);
  await browserService.autoScroll(page);

  await browser.close();
  logger.info("Download Complete");
}

// Prompt the user for login credentials and target username
Inquirer.prompt([
  {
    type: "input",
    message: "Login: Enter X Username: ",
    name: "loginUsername",
  },
  {
    type: "password",
    message: "Enter X Password: ",
    name: "loginPassword",
  },
  {
    type: "input",
    message: "Enter the X account handle to fetch media from: ",
    name: "targetUsername",
  }
]).then((answers) => {
  getTwitterImages(answers.targetUsername, answers.loginUsername, answers.loginPassword);
});
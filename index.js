import puppeteer from 'puppeteer';
import fs from 'fs';
import Inquirer from 'inquirer';
import chalk from 'chalk';
import downloader  from './lib/downloader.js';
import config from './config.js';

const MAX_RETRIES = 3;

/**
 * Automatically scrolls the page to load all media.
 * @param {Object} page - The Puppeteer page object.
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

/**
 * Logs in to Twitter using provided credentials.
 * @param {Object} page - The Puppeteer page object.
 * @param {string} username - The Twitter username.
 * @param {string} password - The Twitter password.
 */
async function loginToTwitter(page, username, password) {
  try {
    await page.goto(config.urls.login, { waitUntil: 'networkidle2' });

    await page.waitForSelector(config.selectors.usernameInput);
    await page.type(config.selectors.usernameInput, username);

    // Click the "Next" button using XPath
    const [nextButton] = await page.$x(config.selectors.nextButtonXPath);
    if (nextButton) {
      await nextButton.click();
    } else {
      throw new Error("Next button not found");
    }

    await page.waitForTimeout(config.timeouts.short);

    await page.waitForSelector(config.selectors.passwordInput);
    await page.type(config.selectors.passwordInput, password);

    await page.waitForSelector(config.selectors.loginButton, { visible: true });
    await page.click(config.selectors.loginButton);

    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  } catch (error) {
    console.error(chalk.red("Error during login:"), error);
    throw error;
  }
}

/**
 * Fetches and downloads images from the specified Twitter account.
 * @param {string} accountToFetch - The Twitter username of the account to fetch media from.
 * @param {string} username - Credentials: Username for login.
 * @param {string} password - Credentials: Password for login.
 */
async function getTwitterImages(accountToFetch, username, password) {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--disable-notifications"],
  });

  const page = await browser.newPage();
  await page.setViewport(config.viewport);

  const dir = `./images`;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  page.on("response", async (response) => {
    const url = response.url();
    if (response.request().resourceType() === "image" && url.match(config.regex.imageUrl)) {
      const cleanurl = url.replace(config.regex.urlCleaner, "&name=large");

      try {
        const imageDetails = cleanurl.match(config.regex.imageDetails);
        const imageName = imageDetails[1];
        const imageExtension = imageDetails[2];
        console.log(chalk.magenta("Downloading..."));
        await downloader(cleanurl, imageName, imageExtension, accountToFetch);
      } catch (error) {
        console.error(chalk.red("Error downloading image:"), error);
      }
    }
  });

  // Retry login in case of failure
  for (let retries = 0; retries < MAX_RETRIES; retries++) {
    try {
      await loginToTwitter(page, username, password);
      break;
    } catch (error) {
      console.warn(chalk.yellow(`Retrying login (${retries + 1}/${MAX_RETRIES})`));
      if (retries === MAX_RETRIES - 1) {
        console.error(chalk.red("Max retries reached. Exiting..."));
        await browser.close();
        return;
      }
    }
  }

  const mediaUrl = `${config.urls.base}/${accountToFetch.replace("@", "")}/media`;
  await page.goto(mediaUrl, { waitUntil: "networkidle0" });

  await autoScroll(page);
  await browser.close();
  console.log(chalk.cyan("Download Complete"));
}

// Prompt the user for login credentials and target username
Inquirer.prompt([
  {
    type: "input",
    message: chalk.cyan("Login: Enter X Username: "),
    name: "loginUsername",
  },
  {
    type: "password",
    message: chalk.cyan("Enter X Password: "),
    name: "loginPassword",
  },
  {
    type: "input",
    message: chalk.magenta("Enter the X account handle to fetch media from: "),
    name: "targetUsername",
  }
]).then((answers) => {
  getTwitterImages(answers.targetUsername, answers.loginUsername, answers.loginPassword);
});

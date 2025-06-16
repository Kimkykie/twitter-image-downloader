// src/config/config.js
import dotenv from 'dotenv';

dotenv.config();

export default {
  credentials: {
    username: process.env.TWITTER_USERNAME,
    password: process.env.TWITTER_PASSWORD
  },
  urls: {
    login: process.env.LOGIN_URL || "https://x.com/i/flow/login",
    base: process.env.BASE_URL || "https://x.com",
  },
  selectors: {
    usernameInput: 'input[name="text"]',
    nextButtonXPath: "xpath/.//button[@role='button' and .//span[text()='Next']]",
    passwordInput: 'input[name="password"]',
    loginButton: 'button[data-testid="LoginForm_Login_Button"]',

    // Selector for links to individual tweets on the /media page.
    mediaPageTweetLinkAnchor: 'li[role="listitem"] a[href*="/status/"]',

    // Selector for images on an individual tweet page.
    tweetPageImage: 'article[data-testid="tweet"] div[data-testid="tweetPhoto"] img, article[data-testid="tweet"] div[data-testid="tweetPhoto"] video[poster]',

    // Fallback selector for images, especially in carousels or different layouts.
    tweetPageCarouselImage: 'div[aria-label*="Image"] img, li div[role="group"] img',

    // **NEW SELECTOR ADDED**
    // Selector for the time element from which to extract the tweet's publication date.
    tweetDateSelector: 'article[data-testid="tweet"] time[datetime]',
    // Selector for the main article element of a tweet
    tweetArticleSelector: 'article[data-testid="tweet"]',
  },
  timeouts: {
    short: parseInt(process.env.SHORT_TIMEOUT) || 3000,
    medium: parseInt(process.env.MEDIUM_TIMEOUT) || 5000,
    long: parseInt(process.env.LONG_TIMEOUT) || 10000,
    navigation: parseInt(process.env.NAVIGATION_TIMEOUT) || 30000, // For page.goto
    selector: parseInt(process.env.SELECTOR_TIMEOUT) || 10000, // For waitForSelector
  },
  viewport: {
    width: parseInt(process.env.VIEWPORT_WIDTH) || 1366,
    height: parseInt(process.env.VIEWPORT_HEIGHT) || 768,
  },
  regex: {
    imageUrl: /(https:\/\/pbs.twimg.com\/media\/(.*?))/,
    // Extracts tweet ID from a tweet URL
    tweetIdFromUrl: /\/status\/(\d+)/,
  },
  puppeteer: {
    headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : "new", // Updated to "new" for modern Puppeteer
    slowMo: parseInt(process.env.PUPPETEER_SLOWMO) || 50,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certifcate-errors',
      '--ignore-certifcate-errors-spki-list',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      // Mitigate detection
      '--disable-blink-features=AutomationControlled',
    ],
  },
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36', // More recent UA
  // Configuration for batch processing
  batchProcessing: {
    // Number of accounts to process in one go if a list is provided.
    // Currently, it processes all accounts in the list sequentially.
    // This could be used for future enhancements like taking breaks between batches.
    accountsPerBatch: 5, // Example, not currently implemented in the loop logic this way
  }
};

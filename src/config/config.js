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

    // **NEW SELECTORS ADDED**
    // Selector for links to individual tweets on the /media page.
    // This targets <a> tags within <article data-testid="tweet"> elements.
    // It specifically looks for links whose href contains '/status/'.
    mediaPageTweetLinkAnchor: 'article[data-testid="tweet"] a[href*="/status/"]',

    // Selector for images on an individual tweet page.
    // Targets <img> tags within a container that usually holds tweet photos.
    // This is for the main tweet content area. Includes video posters as well.
    tweetPageImage: 'article[data-testid="tweet"] div[data-testid="tweetPhoto"] img, article[data-testid="tweet"] div[data-testid="tweetPhoto"] video[poster]',

    // Fallback selector for images, especially in carousels or different layouts.
    // This targets <img> tags that might be within a more generic "Image" labeled container or part of a list.
    // The `[aria-label*="Image"]` part can be helpful for carousels.
    // The `li div[role="group"] img` is another pattern seen for multi-image layouts.
    tweetPageCarouselImage: 'div[aria-label*="Image"] img, li div[role="group"] img',
  },
  timeouts: {
    short: parseInt(process.env.SHORT_TIMEOUT) || 3000,
    medium: parseInt(process.env.MEDIUM_TIMEOUT) || 5000,
    long: parseInt(process.env.LONG_TIMEOUT) || 10000,
  },
  viewport: {
    width: parseInt(process.env.VIEWPORT_WIDTH) || 1366,
    height: parseInt(process.env.VIEWPORT_HEIGHT) || 768,
  },
  regex: {
    imageUrl: /(https:\/\/pbs.twimg.com\/media\/(.*?))/, // Keep this
    // urlCleaner and imageDetails are effectively handled by the improved parseImageUrl in imageService.js
    // urlCleaner: /(&name=([a-zA-Z0-9_]*$))\b/,
    // imageDetails: /https:\/\/pbs.twimg.com\/media\/(.*?)\?format=(.*)&name=(.*)/,
  },
  puppeteer: {
    headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : true, // Corrected boolean conversion
    slowMo: parseInt(process.env.PUPPETEER_SLOWMO) || 50,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certifcate-errors',
      '--ignore-certifcate-errors-spki-list',
      '--disable-dev-shm-usage', // Often useful in Docker/CI environments
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      // '--single-process', // Can be useful for debugging but generally not recommended
      '--disable-gpu', // Can help in headless environments
    ],
  },
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
};

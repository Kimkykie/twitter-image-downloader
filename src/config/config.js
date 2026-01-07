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
  },
  // Database configuration for persistent tracking
  database: {
    path: process.env.DB_PATH || './data/twitter_downloads.db',
    // How many previously processed tweet IDs to load into memory for incremental detection
    maxCachedTweetIds: parseInt(process.env.MAX_CACHED_TWEET_IDS) || 5000,
    // Early stop: stop scrolling when encountering consecutive already-processed tweets
    // Disabled by default - user must opt-in via CLI (--early-stop) or ENV
    earlyStopEnabled: process.env.EARLY_STOP_ENABLED === 'true',
    // How many consecutive known tweets to encounter before stopping scroll (when enabled)
    earlyStopThreshold: parseInt(process.env.EARLY_STOP_THRESHOLD) || 20,
  },
  // Parallel processing configuration
  parallelProcessing: {
    // Enable parallel processing mode
    enabled: process.env.PARALLEL_ENABLED !== 'false',
    // Number of browser tabs to use for parallel processing
    tabCount: parseInt(process.env.PARALLEL_TABS) || 3,
    // Minimum delay between any two tabs starting navigation (ms)
    staggerDelay: parseInt(process.env.STAGGER_DELAY) || 2000,
    // Maximum retries per tweet before giving up
    maxRetriesPerTweet: parseInt(process.env.MAX_TWEET_RETRIES) || 3,
    // Global backoff duration when rate limited (ms)
    rateLimitBackoff: parseInt(process.env.RATE_LIMIT_BACKOFF) || 60000,
  },
  // Resume capability configuration
  resume: {
    // Enable resume capability
    enabled: process.env.RESUME_ENABLED !== 'false',
    // Auto-resume without prompting (if false, will ask user)
    autoResume: process.env.AUTO_RESUME === 'true',
  },
  // Download behavior configuration
  download: {
    // Order: 'newest' or 'oldest' first
    order: process.env.DOWNLOAD_ORDER || 'newest',
  },
  // Retry configuration
  retry: {
    // Max retries for tweet page navigation
    maxTweetRetries: parseInt(process.env.MAX_TWEET_RETRIES) || 3,
    // Max retries for image downloads
    maxImageRetries: parseInt(process.env.MAX_IMAGE_RETRIES) || 3,
    // Base delay between retries (ms) - will be multiplied by attempt number
    retryBaseDelay: parseInt(process.env.RETRY_BASE_DELAY) || 2000,
  }
};

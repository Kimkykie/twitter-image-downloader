// src/config.js
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
    nextButtonXPath: "//button[@role='button' and .//span[text()='Next']]",
    passwordInput: 'input[name="password"]',
    loginButton: 'button[data-testid="LoginForm_Login_Button"]',
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
    imageUrl: /(https:\/\/pbs.twimg.com\/media\/(.*?))/,
    urlCleaner: /(&name=([a-zA-Z0-9_]*$))\b/,
    imageDetails: /https:\/\/pbs.twimg.com\/media\/(.*?)\?format=(.*)&name=(.*)/,
  },
  puppeteer: {
    headless: process.env.PUPPETEER_HEADLESS === 'false',
    slowMo: parseInt(process.env.PUPPETEER_SLOWMO) || 50,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certifcate-errors',
      '--ignore-certifcate-errors-spki-list',
    ],
  },
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
};
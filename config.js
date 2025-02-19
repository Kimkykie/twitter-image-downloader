// config.mjs

export default {
    urls: {
      login: "https://x.com/i/flow/login", // URL for the login page
      base: "https://x.com", // Base URL for Twitter
    },
    selectors: {
      usernameInput: 'input[name="text"]', // Selector for the username input field
      nextButtonXPath: "//button[@role='button' and .//span[text()='Next']]", // XPath for the "Next" button in the login flow
      passwordInput: 'input[name="password"]', // Selector for the password input field
      loginButton: 'button[data-testid="LoginForm_Login_Button"]', // Selector for the login button
    },
    timeouts: {
      short: 3000, // General short timeout duration in milliseconds
    },
    viewport: {
      width: 1366, // Width of the browser viewport
      height: 768, // Height of the browser viewport
    },
    regex: {
      imageUrl: /(https:\/\/pbs.twimg.com\/media\/(.*))/, // Regex pattern to match Twitter image URLs
      urlCleaner: /(&name=([a-zA-Z0-9_]*$))\b/, // Regex pattern to clean URL parameters
      imageDetails: /https:\/\/pbs.twimg.com\/media\/(.*)\?format=(.*)&name=(.*)/, // Regex pattern to extract image details from URL
    },
  };
  
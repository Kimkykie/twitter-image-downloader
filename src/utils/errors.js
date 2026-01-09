// src/utils/errors.js

/**
 * Custom error classes for the Twitter Image Downloader.
 * These provide better error categorization for handling different failure modes.
 */

/**
 * Thrown when a browser page crashes or becomes unresponsive.
 */
export class PageCrashedError extends Error {
  constructor(message = 'Browser page crashed') {
    super(message);
    this.name = 'PageCrashedError';
  }
}

/**
 * Thrown when Twitter rate limits the requests (HTTP 429).
 */
export class RateLimitError extends Error {
  constructor(message = 'Rate limited by Twitter') {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Thrown when the session expires and user is redirected to login.
 */
export class SessionExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Thrown when navigation to a page times out.
 */
export class NavigationTimeoutError extends Error {
  constructor(message = 'Navigation timed out', url = null) {
    super(message);
    this.name = 'NavigationTimeoutError';
    this.url = url;
  }
}

/**
 * Thrown when a tweet is not found or has been deleted.
 */
export class TweetNotFoundError extends Error {
  constructor(tweetUrl = null) {
    super(`Tweet not found: ${tweetUrl || 'unknown'}`);
    this.name = 'TweetNotFoundError';
    this.tweetUrl = tweetUrl;
  }
}

/**
 * Thrown when an image download fails after all retries.
 */
export class ImageDownloadError extends Error {
  constructor(imageUrl, originalError = null) {
    super(`Failed to download image: ${imageUrl}`);
    this.name = 'ImageDownloadError';
    this.imageUrl = imageUrl;
    this.originalError = originalError;
  }
}

/**
 * Thrown when the browser disconnects unexpectedly.
 */
export class BrowserDisconnectedError extends Error {
  constructor(message = 'Browser disconnected unexpectedly') {
    super(message);
    this.name = 'BrowserDisconnectedError';
  }
}

/**
 * Checks if an error is retryable.
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is retryable
 */
export function isRetryableError(error) {
  // Network errors are retryable
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  // Navigation timeouts are retryable
  if (error instanceof NavigationTimeoutError) {
    return true;
  }

  // Rate limit errors need backoff but are retryable
  if (error instanceof RateLimitError) {
    return true;
  }

  // Page crashed errors are retryable (with page recreation)
  if (error instanceof PageCrashedError) {
    return true;
  }

  // Session expired needs re-auth but is technically retryable
  if (error instanceof SessionExpiredError) {
    return true;
  }

  // Tweet not found is not retryable
  if (error instanceof TweetNotFoundError) {
    return false;
  }

  // Default: check for common retryable patterns in message
  const retryablePatterns = [
    'timeout',
    'ECONNRESET',
    'ETIMEDOUT',
    'socket hang up',
    'network',
    'connection'
  ];

  const errorMessage = error.message?.toLowerCase() || '';
  return retryablePatterns.some(pattern => errorMessage.includes(pattern.toLowerCase()));
}

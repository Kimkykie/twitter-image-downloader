// src/utils/fileSystem.js

import fs from 'fs';
import path from 'path';
import logger from './logger.js';

/**
 * Ensures that the specified directory exists.
 * @param {string} dirPath - The path of the directory to create.
 */
export function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.info(`Created directory: ${dirPath}`);
  }
}

/**
 * Creates the images directory for a specific Twitter username.
 * @param {string} twitterUsername - The Twitter username to create a directory for.
 * @returns {string} The path of the created directory.
 */
export function createImageDirectory(twitterUsername) {
  const dirPath = path.join('./images', twitterUsername);
  ensureDirectoryExists(dirPath);
  return dirPath;
}
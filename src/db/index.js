// src/db/index.js
import dbConnection from './connection.js';
import { runMigrations, getCurrentVersion } from './migrations.js';
import accountRepository from './repositories/accountRepository.js';
import tweetRepository from './repositories/tweetRepository.js';
import imageRepository from './repositories/imageRepository.js';
import logger from '../utils/logger.js';

/**
 * Initializes the database connection and runs migrations.
 * @returns {Promise<boolean>} True if successful
 */
export async function initializeDatabase() {
  try {
    dbConnection.getConnection();  // Establish connection
    runMigrations();               // Apply any pending migrations
    logger.info('Database initialized successfully.');
    return true;
  } catch (error) {
    logger.error(`Failed to initialize database: ${error.message}`);
    return false;
  }
}

/**
 * Closes the database connection.
 */
export function closeDatabase() {
  dbConnection.close();
}

/**
 * Gets the current schema version.
 * @returns {number} Current version
 */
export function getSchemaVersion() {
  return getCurrentVersion();
}

export {
  dbConnection,
  accountRepository,
  tweetRepository,
  imageRepository
};

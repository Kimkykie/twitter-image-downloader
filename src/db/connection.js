// src/db/connection.js
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';

/**
 * Singleton database connection manager.
 * Uses better-sqlite3 for synchronous, fast SQLite operations.
 */
class DatabaseConnection {
  constructor() {
    this.db = null;
    this.dbPath = path.join(process.cwd(), 'data', 'twitter_downloads.db');
  }

  /**
   * Gets or creates the database connection.
   * @returns {Database.Database} The database instance
   */
  getConnection() {
    if (!this.db) {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        logger.info(`Created data directory: ${dataDir}`);
      }

      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrent performance
      this.db.pragma('journal_mode = WAL');
      // Enable foreign key constraints
      this.db.pragma('foreign_keys = ON');

      logger.info(`Database connection established: ${this.dbPath}`);
    }
    return this.db;
  }

  /**
   * Sets a custom database path (useful for testing).
   * @param {string} dbPath - The path to the database file
   */
  setDbPath(dbPath) {
    if (this.db) {
      this.close();
    }
    this.dbPath = dbPath;
  }

  /**
   * Closes the database connection.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database connection closed.');
    }
  }

  /**
   * Checks if the database is connected.
   * @returns {boolean}
   */
  isConnected() {
    return this.db !== null;
  }
}

export default new DatabaseConnection();

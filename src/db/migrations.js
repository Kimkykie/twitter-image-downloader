// src/db/migrations.js
import dbConnection from './connection.js';
import logger from '../utils/logger.js';

/**
 * Array of migrations to apply.
 * Each migration has a version number, description, and up function.
 * Migrations are applied in order and tracked in schema_version table.
 */
const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema - accounts, tweets, images, processing_runs tables',
    up: (db) => {
      // Accounts table - tracks per-account metadata
      db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          last_run_at TEXT,
          last_tweet_id TEXT,
          total_tweets_processed INTEGER DEFAULT 0,
          total_images_downloaded INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Tweets table - tracks processed tweets
      db.exec(`
        CREATE TABLE IF NOT EXISTS tweets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tweet_id TEXT NOT NULL UNIQUE,
          account_id INTEGER NOT NULL,
          tweet_url TEXT NOT NULL,
          tweet_date TEXT,
          image_count INTEGER DEFAULT 0,
          status TEXT DEFAULT 'processed',
          processed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);

      // Images table - tracks individual image downloads
      db.exec(`
        CREATE TABLE IF NOT EXISTS images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tweet_id INTEGER NOT NULL,
          image_url TEXT NOT NULL,
          filename TEXT NOT NULL,
          file_path TEXT,
          status TEXT DEFAULT 'pending',
          status_reason TEXT,
          downloaded_at TEXT,
          file_size INTEGER,
          FOREIGN KEY (tweet_id) REFERENCES tweets(id) ON DELETE CASCADE,
          UNIQUE(tweet_id, image_url)
        )
      `);

      // Processing runs table - for resume capability
      db.exec(`
        CREATE TABLE IF NOT EXISTS processing_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          total_tweets INTEGER,
          processed_tweets INTEGER DEFAULT 0,
          status TEXT DEFAULT 'in_progress'
        )
      `);

      // Create indexes for common queries
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
        CREATE INDEX IF NOT EXISTS idx_tweets_tweet_id ON tweets(tweet_id);
        CREATE INDEX IF NOT EXISTS idx_tweets_account_id ON tweets(account_id);
        CREATE INDEX IF NOT EXISTS idx_tweets_processed_at ON tweets(processed_at);
        CREATE INDEX IF NOT EXISTS idx_images_tweet_id ON images(tweet_id);
        CREATE INDEX IF NOT EXISTS idx_images_status ON images(status);
        CREATE INDEX IF NOT EXISTS idx_processing_runs_username_status ON processing_runs(username, status);
      `);
    }
  },
  // Future migrations go here
  // { version: 2, description: '...', up: (db) => { ... } }
];

/**
 * Runs all pending migrations.
 * Creates schema_version table if it doesn't exist.
 */
export function runMigrations() {
  const db = dbConnection.getConnection();

  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    )
  `);

  // Get current schema version
  const currentVersionRow = db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get();
  const currentVersion = currentVersionRow?.version || 0;

  logger.info(`Current database schema version: ${currentVersion}`);

  // Apply pending migrations
  let appliedCount = 0;
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      logger.info(`Applying migration v${migration.version}: ${migration.description}`);

      // Run migration in a transaction
      db.transaction(() => {
        migration.up(db);
        db.prepare(
          'INSERT INTO schema_version (version, description) VALUES (?, ?)'
        ).run(migration.version, migration.description);
      })();

      appliedCount++;
    }
  }

  const latestVersion = MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;

  if (appliedCount > 0) {
    logger.info(`Applied ${appliedCount} migration(s). Database now at version ${latestVersion}`);
  } else {
    logger.info(`Database schema is up to date (version ${latestVersion})`);
  }
}

/**
 * Gets the current schema version.
 * @returns {number} The current version number
 */
export function getCurrentVersion() {
  const db = dbConnection.getConnection();
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get();
  return row?.version || 0;
}

// src/db/repositories/accountRepository.js
import dbConnection from '../connection.js';

/**
 * Repository for account-related database operations.
 */
class AccountRepository {
  /**
   * Gets an existing account or creates a new one.
   * @param {string} username - Twitter username (with or without @)
   * @returns {Object} The account record
   */
  getOrCreate(username) {
    const db = dbConnection.getConnection();
    const normalizedUsername = username.toLowerCase().replace(/^@/, '');

    let account = db.prepare(
      'SELECT * FROM accounts WHERE username = ?'
    ).get(normalizedUsername);

    if (!account) {
      const result = db.prepare(
        'INSERT INTO accounts (username) VALUES (?)'
      ).run(normalizedUsername);

      account = {
        id: result.lastInsertRowid,
        username: normalizedUsername,
        last_run_at: null,
        last_tweet_id: null,
        total_tweets_processed: 0,
        total_images_downloaded: 0
      };
    }

    return account;
  }

  /**
   * Gets an account by username.
   * @param {string} username - Twitter username
   * @returns {Object|undefined} The account record or undefined
   */
  getByUsername(username) {
    const db = dbConnection.getConnection();
    const normalizedUsername = username.toLowerCase().replace(/^@/, '');
    return db.prepare('SELECT * FROM accounts WHERE username = ?').get(normalizedUsername);
  }

  /**
   * Gets an account by ID.
   * @param {number} id - Account ID
   * @returns {Object|undefined} The account record or undefined
   */
  getById(id) {
    const db = dbConnection.getConnection();
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }

  /**
   * Updates the last run information for an account.
   * @param {number} accountId - Account ID
   * @param {string} lastTweetId - The most recent tweet ID processed
   */
  updateLastRun(accountId, lastTweetId) {
    const db = dbConnection.getConnection();
    db.prepare(`
      UPDATE accounts
      SET last_run_at = datetime('now'),
          last_tweet_id = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(lastTweetId, accountId);
  }

  /**
   * Gets the last processed tweet ID for an account.
   * @param {string} username - Twitter username
   * @returns {string|null} The last tweet ID or null
   */
  getLastTweetId(username) {
    const db = dbConnection.getConnection();
    const normalizedUsername = username.toLowerCase().replace(/^@/, '');
    const row = db.prepare(
      'SELECT last_tweet_id FROM accounts WHERE username = ?'
    ).get(normalizedUsername);
    return row?.last_tweet_id || null;
  }

  /**
   * Increments the stats counters for an account.
   * @param {number} accountId - Account ID
   * @param {number} tweetsProcessed - Number of tweets to add
   * @param {number} imagesDownloaded - Number of images to add
   */
  incrementStats(accountId, tweetsProcessed, imagesDownloaded) {
    const db = dbConnection.getConnection();
    db.prepare(`
      UPDATE accounts
      SET total_tweets_processed = total_tweets_processed + ?,
          total_images_downloaded = total_images_downloaded + ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(tweetsProcessed, imagesDownloaded, accountId);
  }

  /**
   * Gets statistics for an account.
   * @param {string} username - Twitter username
   * @returns {Object|null} Account stats or null
   */
  getStats(username) {
    const db = dbConnection.getConnection();
    const normalizedUsername = username.toLowerCase().replace(/^@/, '');
    return db.prepare(`
      SELECT
        a.username,
        a.total_tweets_processed,
        a.total_images_downloaded,
        a.last_run_at,
        a.created_at,
        COUNT(DISTINCT t.id) as tracked_tweets,
        SUM(CASE WHEN i.status = 'downloaded' THEN 1 ELSE 0 END) as downloaded_images,
        SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) as failed_images
      FROM accounts a
      LEFT JOIN tweets t ON a.id = t.account_id
      LEFT JOIN images i ON t.id = i.tweet_id
      WHERE a.username = ?
      GROUP BY a.id
    `).get(normalizedUsername);
  }

  /**
   * Gets all tracked accounts.
   * @returns {Array} List of account records
   */
  getAll() {
    const db = dbConnection.getConnection();
    return db.prepare('SELECT * FROM accounts ORDER BY last_run_at DESC').all();
  }
}

export default new AccountRepository();

// src/db/repositories/tweetRepository.js
import dbConnection from '../connection.js';

/**
 * Repository for tweet-related database operations.
 */
class TweetRepository {
  /**
   * Checks if a tweet has been processed.
   * @param {string} tweetId - Twitter tweet ID
   * @returns {boolean} True if processed
   */
  isProcessed(tweetId) {
    const db = dbConnection.getConnection();
    const row = db.prepare(
      "SELECT 1 FROM tweets WHERE tweet_id = ? AND status = 'processed'"
    ).get(tweetId);
    return !!row;
  }

  /**
   * Checks if a tweet exists in the database (any status).
   * @param {string} tweetId - Twitter tweet ID
   * @returns {boolean} True if exists
   */
  exists(tweetId) {
    const db = dbConnection.getConnection();
    const row = db.prepare('SELECT 1 FROM tweets WHERE tweet_id = ?').get(tweetId);
    return !!row;
  }

  /**
   * Gets processed tweet IDs for an account.
   * @param {number} accountId - Account ID
   * @param {number} limit - Maximum number of IDs to return
   * @returns {Array<string>} Array of tweet IDs
   */
  getProcessedTweetIds(accountId, limit = 5000) {
    const db = dbConnection.getConnection();
    return db.prepare(`
      SELECT tweet_id FROM tweets
      WHERE account_id = ? AND status = 'processed'
      ORDER BY processed_at DESC
      LIMIT ?
    `).all(accountId, limit).map(row => row.tweet_id);
  }

  /**
   * Gets all tweet IDs for an account (for incremental detection).
   * @param {number} accountId - Account ID
   * @returns {Array<string>} Array of tweet IDs
   */
  getAllTweetIds(accountId) {
    const db = dbConnection.getConnection();
    return db.prepare(
      'SELECT tweet_id FROM tweets WHERE account_id = ?'
    ).all(accountId).map(row => row.tweet_id);
  }

  /**
   * Creates or updates a tweet record.
   * @param {Object} tweetData - Tweet data
   * @returns {number} The tweet's database ID
   */
  create(tweetData) {
    const db = dbConnection.getConnection();
    const { tweetId, accountId, tweetUrl, tweetDate, imageCount, status } = tweetData;

    db.prepare(`
      INSERT INTO tweets (tweet_id, account_id, tweet_url, tweet_date, image_count, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tweet_id) DO UPDATE SET
        image_count = excluded.image_count,
        status = excluded.status,
        processed_at = datetime('now')
    `).run(tweetId, accountId, tweetUrl, tweetDate, imageCount, status || 'processed');

    // Always query for the ID to ensure we get the correct one
    // (lastInsertRowid is unreliable with ON CONFLICT DO UPDATE)
    const row = db.prepare('SELECT id FROM tweets WHERE tweet_id = ?').get(tweetId);
    return row?.id;
  }

  /**
   * Updates the status of a tweet.
   * @param {string} tweetId - Tweet ID
   * @param {string} status - New status
   */
  updateStatus(tweetId, status) {
    const db = dbConnection.getConnection();
    db.prepare('UPDATE tweets SET status = ? WHERE tweet_id = ?').run(status, tweetId);
  }

  /**
   * Gets a tweet by its Twitter ID.
   * @param {string} tweetId - Tweet ID
   * @returns {Object|undefined} Tweet record
   */
  getByTweetId(tweetId) {
    const db = dbConnection.getConnection();
    return db.prepare('SELECT * FROM tweets WHERE tweet_id = ?').get(tweetId);
  }

  /**
   * Gets a tweet by its database ID.
   * @param {number} id - Database ID
   * @returns {Object|undefined} Tweet record
   */
  getById(id) {
    const db = dbConnection.getConnection();
    return db.prepare('SELECT * FROM tweets WHERE id = ?').get(id);
  }

  /**
   * Gets failed tweets for an account (for retry).
   * @param {number} accountId - Account ID
   * @returns {Array} Failed tweet records
   */
  getFailedTweets(accountId) {
    const db = dbConnection.getConnection();
    return db.prepare(`
      SELECT * FROM tweets
      WHERE account_id = ? AND status = 'failed'
    `).all(accountId);
  }

  /**
   * Gets tweets with failed images for an account.
   * @param {number} accountId - Account ID
   * @returns {Array} Tweet records with failed images
   */
  getTweetsWithFailedImages(accountId) {
    const db = dbConnection.getConnection();
    return db.prepare(`
      SELECT DISTINCT t.* FROM tweets t
      JOIN images i ON t.id = i.tweet_id
      WHERE t.account_id = ? AND i.status = 'failed'
    `).all(accountId);
  }

  /**
   * Counts tweets by status for an account.
   * @param {number} accountId - Account ID
   * @returns {Object} Status counts
   */
  countByStatus(accountId) {
    const db = dbConnection.getConnection();
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM tweets
      WHERE account_id = ?
      GROUP BY status
    `).all(accountId);

    const result = { processed: 0, failed: 0, partial: 0 };
    for (const row of rows) {
      result[row.status] = row.count;
    }
    return result;
  }
}

export default new TweetRepository();

// src/services/progressTracker.js
import dbConnection from '../db/connection.js';
import logger from '../utils/logger.js';

/**
 * Tracks processing progress for resume capability.
 * Uses SQLite to persist progress across sessions.
 */
class ProgressTracker {
  constructor() {
    this.currentRunId = null;
    this.currentUsername = null;
  }

  /**
   * Gets the database connection.
   * @returns {import('better-sqlite3').Database}
   */
  getDb() {
    return dbConnection.getConnection();
  }

  /**
   * Finds an incomplete run for a username.
   * @param {string} username - Twitter username
   * @returns {Object|undefined} The incomplete run or undefined
   */
  findIncompleteRun(username) {
    const db = this.getDb();
    const normalizedUsername = username.toLowerCase().replace(/^@/, '');

    return db.prepare(`
      SELECT * FROM processing_runs
      WHERE username = ? AND status = 'in_progress'
      ORDER BY started_at DESC
      LIMIT 1
    `).get(normalizedUsername);
  }

  /**
   * Gets pending tweets for a run.
   * @param {number} runId - Run ID
   * @returns {Array<string>} Array of tweet URLs
   */
  getPendingTweetUrls(runId) {
    const db = this.getDb();

    // Get tweet URLs that weren't fully processed in the run
    // This requires a tweet_progress table which we'll add
    const run = db.prepare('SELECT * FROM processing_runs WHERE id = ?').get(runId);
    if (!run) return [];

    // For now, we use the tweets table to find unprocessed tweets
    // In the actual implementation, we'd track per-run progress
    return [];
  }

  /**
   * Starts a new processing run or resumes an incomplete one.
   * @param {string} username - Twitter username
   * @param {Array<string>} tweetUrls - Array of tweet URLs to process
   * @returns {Object} Run info with isResume flag
   */
  startOrResumeRun(username, tweetUrls) {
    const db = this.getDb();
    const normalizedUsername = username.toLowerCase().replace(/^@/, '');

    // Check for incomplete run
    const incompleteRun = this.findIncompleteRun(normalizedUsername);

    if (incompleteRun) {
      this.currentRunId = incompleteRun.id;
      this.currentUsername = normalizedUsername;

      return {
        isResume: true,
        runId: incompleteRun.id,
        totalTweets: incompleteRun.total_tweets,
        processedTweets: incompleteRun.processed_tweets,
        remainingTweets: incompleteRun.total_tweets - incompleteRun.processed_tweets,
        startedAt: incompleteRun.started_at
      };
    }

    // Start a new run
    const result = db.prepare(`
      INSERT INTO processing_runs (username, total_tweets, processed_tweets, status)
      VALUES (?, ?, 0, 'in_progress')
    `).run(normalizedUsername, tweetUrls.length);

    this.currentRunId = result.lastInsertRowid;
    this.currentUsername = normalizedUsername;

    return {
      isResume: false,
      runId: this.currentRunId,
      totalTweets: tweetUrls.length,
      processedTweets: 0,
      remainingTweets: tweetUrls.length
    };
  }

  /**
   * Marks a tweet as processed in the current run.
   * @param {Object} result - Processing result
   */
  markTweetProcessed(result) {
    if (!this.currentRunId) return;

    const db = this.getDb();

    db.prepare(`
      UPDATE processing_runs
      SET processed_tweets = processed_tweets + 1
      WHERE id = ?
    `).run(this.currentRunId);
  }

  /**
   * Marks the current run as completed.
   */
  completeRun() {
    if (!this.currentRunId) return;

    const db = this.getDb();

    db.prepare(`
      UPDATE processing_runs
      SET status = 'completed', completed_at = datetime('now')
      WHERE id = ?
    `).run(this.currentRunId);

    logger.info(`Processing run ${this.currentRunId} marked as completed`);

    this.currentRunId = null;
    this.currentUsername = null;
  }

  /**
   * Marks the current run as interrupted (for graceful shutdown).
   */
  interruptRun() {
    if (!this.currentRunId) return;

    const db = this.getDb();

    db.prepare(`
      UPDATE processing_runs
      SET status = 'interrupted'
      WHERE id = ?
    `).run(this.currentRunId);

    logger.info(`Processing run ${this.currentRunId} marked as interrupted`);
  }

  /**
   * Gets the progress of the current run.
   * @returns {Object|null} Progress info
   */
  getCurrentProgress() {
    if (!this.currentRunId) return null;

    const db = this.getDb();
    const run = db.prepare('SELECT * FROM processing_runs WHERE id = ?').get(this.currentRunId);

    if (!run) return null;

    return {
      runId: run.id,
      username: run.username,
      totalTweets: run.total_tweets,
      processedTweets: run.processed_tweets,
      remainingTweets: run.total_tweets - run.processed_tweets,
      percentComplete: run.total_tweets > 0
        ? Math.round((run.processed_tweets / run.total_tweets) * 100)
        : 0,
      status: run.status,
      startedAt: run.started_at
    };
  }

  /**
   * Gets run history for a username.
   * @param {string} username - Twitter username
   * @param {number} limit - Maximum runs to return
   * @returns {Array} Run records
   */
  getRunHistory(username, limit = 10) {
    const db = this.getDb();
    const normalizedUsername = username.toLowerCase().replace(/^@/, '');

    return db.prepare(`
      SELECT * FROM processing_runs
      WHERE username = ?
      ORDER BY started_at DESC
      LIMIT ?
    `).all(normalizedUsername, limit);
  }

  /**
   * Cleans up old interrupted runs (older than 7 days).
   */
  cleanupOldRuns() {
    const db = this.getDb();

    const result = db.prepare(`
      DELETE FROM processing_runs
      WHERE status = 'interrupted'
      AND started_at < datetime('now', '-7 days')
    `).run();

    if (result.changes > 0) {
      logger.info(`Cleaned up ${result.changes} old interrupted runs`);
    }
  }

  /**
   * Cancels an incomplete run (marks as completed with current progress).
   * @param {number} runId - Run ID to cancel
   */
  cancelRun(runId) {
    const db = this.getDb();

    db.prepare(`
      UPDATE processing_runs
      SET status = 'cancelled', completed_at = datetime('now')
      WHERE id = ? AND status = 'in_progress'
    `).run(runId);
  }
}

export default new ProgressTracker();

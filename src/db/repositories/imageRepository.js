// src/db/repositories/imageRepository.js
import dbConnection from '../connection.js';

/**
 * Repository for image-related database operations.
 */
class ImageRepository {
  /**
   * Checks if an image has been downloaded.
   * @param {string} imageUrl - Image URL
   * @returns {boolean} True if downloaded
   */
  isDownloaded(imageUrl) {
    const db = dbConnection.getConnection();
    const row = db.prepare(
      "SELECT 1 FROM images WHERE image_url = ? AND status = 'downloaded'"
    ).get(imageUrl);
    return !!row;
  }

  /**
   * Checks if an image exists in the database (any status).
   * @param {string} imageUrl - Image URL
   * @returns {boolean} True if exists
   */
  exists(imageUrl) {
    const db = dbConnection.getConnection();
    const row = db.prepare('SELECT 1 FROM images WHERE image_url = ?').get(imageUrl);
    return !!row;
  }

  /**
   * Creates or updates an image record.
   * @param {Object} imageData - Image data
   * @returns {number} The image's database ID
   */
  create(imageData) {
    const db = dbConnection.getConnection();
    const {
      tweetDbId,
      imageUrl,
      filename,
      filePath,
      status,
      statusReason,
      fileSize
    } = imageData;

    const result = db.prepare(`
      INSERT INTO images (tweet_id, image_url, filename, file_path, status, status_reason, file_size, downloaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'downloaded' THEN datetime('now') ELSE NULL END)
      ON CONFLICT(tweet_id, image_url) DO UPDATE SET
        status = excluded.status,
        status_reason = excluded.status_reason,
        file_size = excluded.file_size,
        downloaded_at = CASE WHEN excluded.status = 'downloaded' THEN datetime('now') ELSE downloaded_at END
    `).run(tweetDbId, imageUrl, filename, filePath, status, statusReason || null, fileSize || null, status);

    return result.lastInsertRowid;
  }

  /**
   * Gets images for a tweet.
   * @param {number} tweetDbId - Tweet database ID
   * @returns {Array} Image records
   */
  getByTweetDbId(tweetDbId) {
    const db = dbConnection.getConnection();
    return db.prepare('SELECT * FROM images WHERE tweet_id = ?').all(tweetDbId);
  }

  /**
   * Gets an image by URL.
   * @param {string} imageUrl - Image URL
   * @returns {Object|undefined} Image record
   */
  getByUrl(imageUrl) {
    const db = dbConnection.getConnection();
    return db.prepare('SELECT * FROM images WHERE image_url = ?').get(imageUrl);
  }

  /**
   * Gets failed images for an account.
   * @param {number} accountId - Account ID
   * @returns {Array} Failed image records with tweet info
   */
  getFailedImages(accountId) {
    const db = dbConnection.getConnection();
    return db.prepare(`
      SELECT i.*, t.tweet_url, t.tweet_date, t.tweet_id as twitter_tweet_id
      FROM images i
      JOIN tweets t ON i.tweet_id = t.id
      WHERE t.account_id = ? AND i.status = 'failed'
    `).all(accountId);
  }

  /**
   * Updates the status of an image.
   * @param {string} imageUrl - Image URL
   * @param {string} status - New status
   * @param {string} statusReason - Reason for status change
   */
  updateStatus(imageUrl, status, statusReason = null) {
    const db = dbConnection.getConnection();
    db.prepare(`
      UPDATE images
      SET status = ?,
          status_reason = ?,
          downloaded_at = CASE WHEN ? = 'downloaded' THEN datetime('now') ELSE downloaded_at END
      WHERE image_url = ?
    `).run(status, statusReason, status, imageUrl);
  }

  /**
   * Counts images by status for an account.
   * @param {number} accountId - Account ID
   * @returns {Object} Status counts
   */
  countByStatus(accountId) {
    const db = dbConnection.getConnection();
    const rows = db.prepare(`
      SELECT i.status, COUNT(*) as count
      FROM images i
      JOIN tweets t ON i.tweet_id = t.id
      WHERE t.account_id = ?
      GROUP BY i.status
    `).all(accountId);

    const result = { downloaded: 0, skipped: 0, failed: 0, pending: 0 };
    for (const row of rows) {
      result[row.status] = row.count;
    }
    return result;
  }

  /**
   * Gets downloaded image URLs for an account.
   * @param {number} accountId - Account ID
   * @returns {Array<string>} Array of image URLs
   */
  getDownloadedUrls(accountId) {
    const db = dbConnection.getConnection();
    return db.prepare(`
      SELECT i.image_url FROM images i
      JOIN tweets t ON i.tweet_id = t.id
      WHERE t.account_id = ? AND i.status = 'downloaded'
    `).all(accountId).map(row => row.image_url);
  }

  /**
   * Batch insert images (for efficiency).
   * @param {Array} images - Array of image data objects
   */
  createBatch(images) {
    const db = dbConnection.getConnection();
    const insert = db.prepare(`
      INSERT INTO images (tweet_id, image_url, filename, file_path, status, status_reason, file_size, downloaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'downloaded' THEN datetime('now') ELSE NULL END)
      ON CONFLICT(tweet_id, image_url) DO NOTHING
    `);

    const insertMany = db.transaction((images) => {
      for (const img of images) {
        insert.run(
          img.tweetDbId,
          img.imageUrl,
          img.filename,
          img.filePath,
          img.status,
          img.statusReason || null,
          img.fileSize || null,
          img.status
        );
      }
    });

    insertMany(images);
  }
}

export default new ImageRepository();

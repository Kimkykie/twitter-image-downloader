// src/utils/downloadTracker.js
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createObjectCsvWriter } from 'csv-writer';
import logger from './logger.js';
import { ensureDirectoryExists } from './fileSystem.js';

class DownloadTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.totalFound = 0;         // Total images identified from tweets
    this.downloadedImages = 0;
    this.skippedImages = 0;
    this.failedImages = 0;
    this.failedTweetProcessing = 0; // New counter for tweets that couldn't be processed
    this.downloadHistory = [];   // Stores ImageInfo objects
  }

  /**
   * Updates the download progress.
   * @param {('downloaded'|'skipped'|'failed'|'failed_tweet_processing')} status - The status of the image operation.
   * @param {import('../services/imageService.js').ImageInfo} imageInfo - Information about the image.
   */
  updateProgress(status, imageInfo) {
    // Only increment totalFound for actual image items, not tweet processing failures
    if (status !== 'failed_tweet_processing') {
        this.totalFound++;
    }

    let logEntry = {
      filename: imageInfo.filename || 'N/A',
      image_url: imageInfo.url || 'N/A', // Renamed from 'url' to 'image_url' for clarity in CSV
      status: status,
      status_reason: imageInfo.status_reason || '',
      tweet_url: imageInfo.tweetUrl,
      tweet_id: imageInfo.tweetId,
      tweet_date: imageInfo.tweetDate, // Should be ISO string or 'N/A'
      timestamp: new Date().toISOString()
    };

    switch(status) {
      case 'downloaded':
        this.downloadedImages++;
        break;
      case 'skipped':
        this.skippedImages++;
        break;
      case 'failed':
        this.failedImages++;
        break;
      case 'failed_tweet_processing':
        this.failedTweetProcessing++;
        // For failed tweet processing, some imageInfo fields might be N/A
        logEntry.status_reason = imageInfo.status_reason || 'Tweet processing failed';
        break;
    }

    this.downloadHistory.push(logEntry);
    this.logProgress();
  }

  logProgress() {
    // Debounce logging to avoid excessive stdout writes if many images are processed quickly
    if (this.logTimeout) clearTimeout(this.logTimeout);

    this.logTimeout = setTimeout(() => {
        process.stdout.clearLine(0); // Clear current line
        process.stdout.cursorTo(0);  // Move cursor to beginning of line

        const stats = [
        `${chalk.blueBright('Tweets Processed:')} (approx. ${this.downloadHistory.filter(item => item.status !== 'failed_tweet_processing' || this.downloadHistory.map(i => i.tweet_url).includes(item.tweet_url)).map(item => item.tweet_url).filter((v, i, a) => a.indexOf(v) === i).length})`, // Approximation
        `${chalk.cyan('Images Found:')} ${this.totalFound}`,
        `${chalk.green('Downloaded:')} ${this.downloadedImages} ${chalk.green('✓')}`,
        `${chalk.yellow('Skipped:')} ${this.skippedImages} ${chalk.yellow('⇢')}`,
        `${chalk.red('Img Failed:')} ${this.failedImages} ${chalk.red('⨯')}`,
        ].join(' | ');

        const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        // Use a combination of counts to ensure spinner keeps moving
        const spinnerIndex = (this.downloadedImages + this.skippedImages + this.failedImages + this.failedTweetProcessing) % spinners.length;
        const spinner = spinners[spinnerIndex];

        process.stdout.write(`${chalk.cyan(spinner)} Progress: ${stats}`);
    }, 100); // Update console log at most every 100ms
  }

  async exportToCsv(username) {
    if (!username) {
      logger.error('Cannot export CSV: No username provided for context.');
      return;
    }

    if (this.downloadHistory.length === 0) {
      logger.info(`No download history to export for @${username}.`);
      return;
    }

    try {
      const baseDir = path.join(process.cwd(), 'images');
      ensureDirectoryExists(baseDir);

      const userDir = path.join(baseDir, username);
      ensureDirectoryExists(userDir);

      const logsDir = path.join(userDir, 'logs');
      ensureDirectoryExists(logsDir);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const csvPath = path.join(logsDir, `${username}_download_log_${timestamp}.csv`);

      const csvWriterInstance = createObjectCsvWriter({
        path: csvPath,
        header: [
          {id: 'filename', title: 'FILENAME'},
          {id: 'image_url', title: 'IMAGE_URL'},
          {id: 'status', title: 'STATUS'},
          {id: 'status_reason', title: 'STATUS_REASON'},
          {id: 'tweet_url', title: 'TWEET_URL'},
          {id: 'tweet_id', title: 'TWEET_ID'},
          {id: 'tweet_date', title: 'TWEET_DATE'}, // ISO Format
          {id: 'timestamp', title: 'DOWNLOAD_TIMESTAMP'} // Log entry timestamp
        ]
      });

      await csvWriterInstance.writeRecords(this.downloadHistory);
      logger.success(`Download history for @${username} exported to: ${csvPath}`);

    } catch (error) {
      logger.error(`Failed to export download history for @${username}: ${error.message}`, error.stack);
      // Fallback attempt could be added here if critical
    }
  }

  printSummary(username = "current session") {
    if (this.logTimeout) clearTimeout(this.logTimeout); // Clear any pending log update
    process.stdout.write('\n\n'); // Ensure summary starts on a new line

    const summaryBox = [
      chalk.bold.underline(`Download Summary for @${username}`),
      '─'.repeat(60),
      `${chalk.bold('Total unique images identified:')} ${chalk.white(this.totalFound)}`,
      `${chalk.bold('Successfully downloaded:')} ${chalk.green(this.downloadedImages)} ${chalk.green('✓')}`,
      `${chalk.bold('Skipped (e.g., already exists):')} ${chalk.yellow(this.skippedImages)} ${chalk.yellow('⇢')}`,
      `${chalk.bold('Failed image downloads:')} ${chalk.red(this.failedImages)} ${chalk.red('⨯')}`,
      `${chalk.bold('Failed tweet processing (no images):')} ${chalk.magenta(this.failedTweetProcessing)} ${chalk.magenta('!')}`,
      '─'.repeat(60)
    ].join('\n');

    console.log(summaryBox);
  }
}

export default new DownloadTracker();

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
    this.totalFound = 0;      // Total images found while scrolling
    this.downloadedImages = 0;
    this.skippedImages = 0;
    this.failedImages = 0;
    this.downloadHistory = [];
  }

  updateProgress(status, imageInfo) {
    this.totalFound++;

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
    }

    this.downloadHistory.push({
      filename: imageInfo.filename,
      url: imageInfo.url,
      status,
      timestamp: new Date().toISOString()
    });

    this.logProgress();
  }

  logProgress() {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);

    // Instead of a progress bar, show live counters with status indicators
    const stats = [
      `${chalk.blue('Found:')} ${this.totalFound}`,
      `${chalk.green('✓')} ${this.downloadedImages}`,
      `${chalk.yellow('⇢')} ${this.skippedImages}`,
      `${chalk.red('⨯')} ${this.failedImages}`
    ].join(' | ');

    // Add spinning cursor to indicate active scanning
    const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const spinner = spinners[this.totalFound % spinners.length];

    process.stdout.write(
      `\r${chalk.cyan(spinner)} Scanning... ${stats}`
    );
  }

  async exportToCsv(username) {
    if (this.downloadHistory.length === 0) {
      logger.info('\nNo download history to export');
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
      const csvPath = path.join(logsDir, `download_history_${timestamp}.csv`);

      const csvWriter = createObjectCsvWriter({
        path: csvPath,
        header: [
          {id: 'filename', title: 'FILENAME'},
          {id: 'url', title: 'URL'},
          {id: 'status', title: 'STATUS'},
          {id: 'timestamp', title: 'TIMESTAMP'}
        ]
      });

      await csvWriter.writeRecords(this.downloadHistory);
      logger.success(`\nDownload history exported to: ${chalk.underline(csvPath)}`);

    } catch (error) {
      logger.error('\nFailed to export download history:', error);
    }
  }

  printSummary() {
    // Move to new line for summary
    process.stdout.write('\n\n');

    const summaryBox = [
      chalk.bold('Download Summary'),
      '─'.repeat(50),
      `${chalk.bold('Total images found:')} ${chalk.white(this.totalFound)}`,
      `${chalk.bold('Successfully downloaded:')} ${chalk.green(this.downloadedImages)} ${chalk.green('✓')}`,
      `${chalk.bold('Skipped (already exists):')} ${chalk.yellow(this.skippedImages)} ${chalk.yellow('⇢')}`,
      `${chalk.bold('Failed downloads:')} ${chalk.red(this.failedImages)} ${chalk.red('⨯')}`,
      '─'.repeat(50)
    ].join('\n');

    console.log(summaryBox);
  }
}

export default new DownloadTracker();
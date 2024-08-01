// lib/downloader.js

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { promisify } from 'util';
import { createImageDirectory } from '../src/utils/fileSystem.js';
import logger from '../src/utils/logger.js';

const writeFile = promisify(fs.writeFile);

/**
 * Downloads an image from the given URI and saves it locally.
 * @param {string} uri - The URI of the image to download.
 * @param {string} name - The name to give the downloaded image file.
 * @param {string} extension - The file extension of the image.
 * @param {string} twitterUsername - The Twitter username to create a directory for storing the image.
 * @returns {Promise<void>} A promise that resolves when the download is complete.
 */
async function downloader(uri, name, extension, twitterUsername) {
  try {
    // Ensure the directory exists
    const twitterUsernamePath = createImageDirectory(twitterUsername);

    // Set the file path
    const filePath = path.resolve(twitterUsernamePath, `${name}.${extension}`);

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      logger.info(`File ${name}.${extension} already exists. Skipping download.`);
      return;
    }

    // Download the image
    const response = await axios({
      url: uri,
      method: 'GET',
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    // Save the image to the file
    await writeFile(filePath, response.data);

    logger.info(`Successfully downloaded: ${name}.${extension}`);
  } catch (error) {
    if (error.response) {
      logger.error(`Error downloading image: ${error.response.status} - ${error.response.statusText}`);
    } else if (error.request) {
      logger.error('Error downloading image: No response received');
    } else {
      logger.error(`Error in download function: ${error.message}`);
    }
    throw error;
  }
}

export default downloader;
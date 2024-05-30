import fs from 'fs';
import path from 'path';
import axios from 'axios';

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
    const twitterUsernamePath = path.join('./images', twitterUsername);
    if (!fs.existsSync(twitterUsernamePath)) {
      fs.mkdirSync(twitterUsernamePath, { recursive: true });
    }

    // Set the file path
    const filePath = path.resolve(twitterUsernamePath, `${name}.${extension}`);

    // Download the image and save it to the file
    const response = await axios({
      url: uri,
      method: 'GET',
      responseType: 'stream',
    });

    response.data.pipe(fs.createWriteStream(filePath))
      .on('error', (error) => {
        console.error(`Error downloading image: ${error.message}`);
        throw error;
      });
  } catch (error) {
    console.error(`Error in download function: ${error.message}`);
    throw error;
  }
}

export default downloader;

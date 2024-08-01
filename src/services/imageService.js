import config from '../config/config.js';
import downloader from '../../lib/downloader.js';
import logger from '../utils/logger.js';

/**
 * Handles image-related operations.
 */
class ImageService {
  /**
   * Sets up image download listeners on the page.
   * @param {Object} page - The Puppeteer page object.
   * @param {string} accountToFetch - The Twitter username to fetch images from.
   */
  setupImageDownloadListeners(page, accountToFetch) {
    page.on("response", async (response) => {
      const url = response.url();
      if (response.request().resourceType() === "image" && url.match(config.regex.imageUrl)) {
        const cleanurl = url.replace(config.regex.urlCleaner, "&name=large");

        try {
          const imageDetails = cleanurl.match(config.regex.imageDetails);
          const imageName = imageDetails[1];
          const imageExtension = imageDetails[2];
          logger.info(`Downloading image: ${imageName}.${imageExtension}`);
          await downloader(cleanurl, imageName, imageExtension, accountToFetch);
        } catch (error) {
          logger.error("Error downloading image:", error);
        }
      }
    });
  }

  /**
   * Navigates to the media page of the specified Twitter account.
   * @param {Object} page - The Puppeteer page object.
   * @param {string} accountToFetch - The Twitter username to fetch images from.
   * @returns {Promise<void>}
   */
  async navigateToMediaPage(page, accountToFetch) {
    const mediaUrl = `${config.urls.base}/${accountToFetch.replace("@", "")}/media`;
    await page.goto(mediaUrl, { waitUntil: "networkidle0" });
    logger.info(`Navigated to media page: ${mediaUrl}`);
  }
}

export default new ImageService();
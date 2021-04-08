const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const request = require("request");
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

const argv = yargs(hideBin(process.argv)).argv

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        var scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

function download(uri) {
  return new Promise((resolve, reject) => {
    request.head(uri, function (err, res, body) {
      const filePath = path.resolve(
        `${__dirname}/images`,
        `${Date.now()}`
      );
      request(uri).pipe(fs.createWriteStream(filePath)).on("close", resolve);
    });
  });
}

async function getTwitterImages() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--disable-notifications"],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 1366,
    height: 768,
  });
  const dir = `./images`;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  page.on("response", async (response) => {
    let url = response.url();
    if (response.request().resourceType() === "image") {
      /**
       * Filter to only collect tweet images and ignore profile pictures and banners.
       */
      if (url.match("(https://pbs.twimg.com/media/(.*))")) {
      /**
       * Convert twitter image urls to high quality
       */
        const urlcleaner = /(&name=([a-zA-Z0-9_]*$))\b/;
        let cleanurl = url.replace(urlcleaner, "&name=large");
        console.log(`Downloading...`);
        await download(cleanurl);
      }
    }
  });

  const pageUrl = `https://twitter.com/${argv.handle.replace('@', '')}`;

  await page.goto(pageUrl, {
    timeout: 0,
    waitUntil: "networkidle0",
  });
  await autoScroll(page);
  await browser.close();
  console.log('Download Complete');
}

getTwitterImages();

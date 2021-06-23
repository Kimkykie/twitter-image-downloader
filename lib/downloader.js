const fs = require("fs");
const path = require("path");
const request = require("request");

function download(uri, name, extension, twitterUsername) {
  return new Promise((resolve, reject) => {
    request.head(uri, function (err, res, body) {
      const twitterUsernamePath = `${"./"}/images/${twitterUsername}`;
      if (!fs.existsSync(twitterUsernamePath)) {
        fs.mkdirSync(twitterUsernamePath);
      }
      const filePath = path.resolve(
        twitterUsernamePath,
        `${name}.${extension}`
      );
      request(uri).pipe(fs.createWriteStream(filePath)).on("close", resolve);
    });
  });
}

module.exports = download;

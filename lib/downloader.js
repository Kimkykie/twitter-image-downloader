const fs = require("fs");
const path = require("path");
const request = require("request");

function download(uri, name, extension) {
  return new Promise((resolve, reject) => {
    request.head(uri, function (err, res, body) {
      const filePath = path.resolve(`${"./"}/images`, `${name}.${extension}`);
      request(uri).pipe(fs.createWriteStream(filePath)).on("close", resolve);
    });
  });
}

module.exports = download;

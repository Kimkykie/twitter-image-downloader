# Twitter Timeline Image Downloader

 This is a simple tool to download images posted/retweeted in a user's timeline.

## Modules included
- Puppeteer -  Node.js library which provides a high-level API to control headless Chrome or Chromium or to interact with the DevTools protocol. I use it for web crawling and scarping in this project.
- Request - Simplified http request client
- Yargs - Yargs helps you build interactive command line tools, by parsing arguments and generating an elegant user interface

## Installation
#### Prerequisite
The project runs on nodejs so make sure you have nodejs installed before installation and running it.

You can find instructions on how to install Nodejs and npm [here](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)

On your terminal
```bash
git clone https://github.com/Kimkykie/twitter-image-downloader
cd twitter-image-downloader
npm install
```

## Usage
The code is located in ```twitter.js```

#### Project Structure
The profile images will be downloaded to the ```images``` directory

#### How to Download Images
Once in the ```twitter-image-downloader``` directory, run the command below replacing **TwitterHandle** with the username of the Twitter Profile you want to download images from.

```bash
npm start -- --handle TwitterHandle
```

Puppeteer is currently set to ```headless:false``` if you want to see the web crawling process. You can change this to ```headless:true``` in ```twitter.js``` if you want it to run in headless mode.

The script will run scrolling through the user timeline until it reaches Twitter maximum number of viewable tweets and once done, a **```Download Complete```** log will be printed in your console or browser automatically closes if your browser is not in headless mode.

To view images, open your ```images```folder.

## Disclaimer

This tool is used for educational purposes to see how puppeteer can be utilized for image scraping.

## License
[MIT](https://choosealicense.com/licenses/mit/)
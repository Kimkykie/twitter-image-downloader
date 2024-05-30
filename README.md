# Twitter Timeline Image Downloader

This is a simple tool to download images posted/retweeted in a user's timeline.

## Modules included

- **Puppeteer**: A Node.js library which provides a high-level API to control headless Chrome or Chromium or to interact with the DevTools protocol. It is used for web crawling and scraping in this project.
- **Axios**: A promise-based HTTP client for the browser and Node.js, used here as a replacement for the deprecated `request` module.
- **Inquirer**: An easily embeddable and beautiful command line interface for Node.js.
- **Chalk**: A library that provides a simple and easy-to-use interface for applying ANSI colors and styles to your command-line output.

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

The code is located in `index.js`

#### Project Structure

The profile images will be downloaded to the `images` directory

#### How to Download Images

Once in the `twitter-image-downloader` directory, run the command below and you will be prompted to enter with the username of the Twitter Profile you want to download images from.

```bash
npm start
```

Enter the twitter username with or without the @

```bash
? Enter X Username:
? Enter X Password:
? Enter the X account handle to fetch media from:
```

The script will start running and create a folder with the `username` you entered in the images folder.

Puppeteer is currently set to `headless:false` if you want to see the web crawling process. You can change this to `headless:true` in `index.js` if you want it to run in headless mode.

The script will scroll through the user timeline until it reaches Twitter's maximum number of viewable tweets. Once done, a **Download Complete** log will be printed in your console, or the browser will automatically close if it is not in headless mode.

To view images, open your `images`folder.

## Disclaimer

This tool is used for educational purposes to see how puppeteer can be utilized for image scraping.

## License

[MIT](https://choosealicense.com/licenses/mit/)

# 🐦 Twitter Timeline Image Downloader

An advanced tool to download images from a user's Twitter timeline.

![Project Banner](assets/banner.png)

## ✨ Features

- 🔐 Automated login to Twitter
- 🖼️ Scrapes images from a specified user's timeline
- 📜 Handles pagination to fetch all available images
- 🛡️ Robust error handling and retry mechanisms
- 🚀 Efficient image downloading with duplicate prevention
- 📊 Detailed logging for better debugging and monitoring
- ⚙️ Configurable via environment variables for easy deployment

## 🏗️ Project Structure
```code
twitter-image-downloader/
├── images/
├── src/
│   ├── config/
│   │   └── config.js
│   ├── services/
│   │   ├── authService.js
│   │   ├── browserService.js
│   │   └── imageService.js
│   ├── utils/
│   │   ├── logger.js
│   │   └── fileSystem.js
│   └── index.js
├── lib/
│   └── downloader.js
├── images/
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

## 🛠️ Technologies Used

- **Node.js**: Runtime environment
- **Puppeteer**: Web scraping and automation
- **Axios**: HTTP client for image downloads
- **Winston**: Logging framework
- **Inquirer**: Command-line user interface
- **Dotenv**: Environment variable management

## 📥 Installation

### Prerequisites

Ensure you have Node.js (version 14 or higher) and npm installed on your system.

### Steps

1. Clone the repository:
```bash
git clone https://github.com/Kimkykie/twitter-image-downloader.git
cd twitter-image-downloader
```

2. Install dependencies:
```bash
npm install
```


3. Copy the `.env.example` file to `.env` and adjust the variables as needed:
```bash
cp .env.example .env
```


## 🚀 Usage

1. Start the application:

```bash
npm start
```

2. Follow the prompts to enter your Twitter credentials and the username of the account you want to download images from.

3. The script will start running and create a folder with the username you entered in the `images` folder.

4. Once complete, you'll see a "Download Complete" message in your console.


## ⚙️ Configuration

You can configure the application by modifying the `.env` file. Available options include:

- `PUPPETEER_HEADLESS`: Set to 'true' for headless mode, 'false' to see the browser (default: false)
- `PUPPETEER_SLOWMO`: Slow down Puppeteer operations by specified milliseconds (default: 50)
- `VIEWPORT_WIDTH` and `VIEWPORT_HEIGHT`: Set the browser viewport size
- Various timeout durations and URLs

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## ⚠️ Disclaimer and Caution

### Risk of Account Flagging
Please be aware that using this tool may potentially lead to your Twitter account being flagged or blocked. Twitter has mechanisms in place to detect automated scraping activities, which could result in account restrictions or bans.

### Use of Sockpuppets
To mitigate risks to your primary account, consider using a sockpuppet account for scraping activities. A sockpuppet is a false online identity created for purposes such as circumventing restrictions or maintaining anonymity.

For more information on sockpuppets and their use in OSINT (Open Source Intelligence), please refer to this <a href="https://www.sans.org/blog/what-are-sock-puppets-in-osint/" target="_blank">SANS Institute article on sockpuppets</a>.

**Remember**: Always use this tool responsibly and in compliance with Twitter's terms of service. The developers of this tool are not responsible for any account restrictions or legal issues that may arise from its use.

## 📄 License

[MIT](https://choosealicense.com/licenses/mit/)

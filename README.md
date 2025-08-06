# Twitter Timeline Image Downloader

Download images from Twitter/X profiles via CLI. Built for OSINT workflows.

<img src="https://i.imgur.com/ytCJ2eA.png" alt="Tool Screenshot" />

## Problem

Need to archive media from Twitter profiles for research or backup. Manual downloading is tedious, and most existing tools break frequently due to Twitter's anti-automation measures.

## Solution

Automated browser-based scraper that handles authentication, infinite scroll, and bulk downloads. Uses session persistence to minimize login friction and includes smart rate limiting to avoid blocks.

## Quick Start

```bash
git clone https://github.com/Kimkykie/twitter-image-downloader.git
cd twitter-image-downloader
npm install
```

Set up environment:
```bash
cp .env.example .env
```

**Important**: Set `PUPPETEER_HEADLESS=false` for first run (Twitter CAPTCHA handling).

```bash
npm start
```

## How it works

1. **Authentication** - Automated login with cookie persistence
2. **Timeline parsing** - Infinite scroll to load all media posts
3. **Download queue** - Parallel downloads with duplicate detection
4. **Progress tracking** - Real-time stats and CSV export

Authentication cookies are saved in `cookies.json`. Delete this file to force re-authentication.

## Configuration

Edit `.env`:
```env
TWITTER_USERNAME=your_username    # Optional - will prompt if missing
TWITTER_PASSWORD=your_password    # Optional - will prompt if missing  
PUPPETEER_HEADLESS=false         # Keep false until authenticated
VIEWPORT_WIDTH=1366              # Browser dimensions
VIEWPORT_HEIGHT=768
```

## Project Structure

```
src/
├── config/config.js           # App configuration
├── services/
│   ├── authService.js         # Login/session handling
│   ├── browserService.js      # Puppeteer automation
│   └── imageService.js        # Download management
├── utils/
│   ├── downloadTracker.js     # Progress tracking
│   ├── logger.js              # Console output
│   └── fileSystem.js          # File operations
└── index.js                   # CLI entry point
```

## Output

- **Images**: `./images/{username}/`
- **Download log**: CSV with metadata and status
- **Session data**: `cookies.json` (auto-generated)

## Rate Limiting

Built-in throttling to avoid Twitter's anti-bot measures:
- Request delays between page interactions
- Automatic backoff on rate limit detection
- Session rotation support

## Security Notes

- Use a dedicated Twitter account for scraping
- Cookies contain authentication tokens, treat as credentials
- Consider VPN/proxy for large-scale operations

## Contributing

Focus areas:
- Twitter layout changes (frequent breakage)
- Alternative authentication methods
- Performance optimization for large timelines

## Roadmap

- [ ] GIF and MP4 download support  
- [ ] Optimized downloading for high-volume accounts

## License

MIT

---

**Disclaimer**: Respect Twitter's Terms of Service and applicable laws. This tool is for research and archival purposes.

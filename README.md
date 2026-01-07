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
3. **Incremental downloads** - Only fetches new tweets since last run (SQLite tracking)
4. **Download queue** - Parallel downloads with duplicate detection
5. **Resume capability** - Continue interrupted downloads from where you left off
6. **Progress tracking** - Real-time stats and CSV export

Authentication cookies are saved in `cookies.json`. Delete this file to force re-authentication.

## Troubleshooting Login Issues

If you get errors like `"Could not log you in"` or `400 Bad Request` on `onboarding/task.json`, Twitter has detected automation. Use manual cookie export instead:

### Manual Cookie Export (Recommended)

1. **Install a cookie export extension:**
   - Chrome: [Cookie-Editor](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
   - Firefox: [Cookie Quick Manager](https://addons.mozilla.org/en-US/firefox/addon/cookie-quick-manager/)

2. **Login to Twitter manually:**
   - Open your browser and go to `https://x.com`
   - Login with your credentials
   - Complete any CAPTCHA or verification prompts

3. **Export cookies:**
   - Click the cookie extension icon while on x.com
   - Click "Export" or "Export as JSON"
   - Copy the JSON content

4. **Save cookies to the project:**
   ```bash
   # Delete old expired cookies
   rm cookies.json

   # Create new cookies.json and paste the exported JSON
   nano cookies.json
   # Or use any text editor
   ```

5. **Run the tool:**
   ```bash
   npm start
   ```

The tool will use your manual session without needing automated login.

### Essential Cookies

Make sure your exported cookies include:
- `auth_token` - Main authentication token
- `ct0` - CSRF protection token
- `twid` - Twitter user ID

### Still Having Issues?

- Wait 15-30 minutes if rate-limited
- Try a different IP (VPN)
- Login manually in browser first to clear security flags
- Check if your account has any security holds

## CLI Usage

```bash
# Interactive mode (prompts for all options)
npm start

# Download from specific accounts
npm start elonmusk
npm start user1 user2 user3

# Control download order
npm start --newest elonmusk      # Download newest tweets first (default)
npm start --oldest elonmusk      # Download oldest tweets first

# Only check for new tweets (stop when hitting already-downloaded tweets)
npm start --new-only elonmusk
npm start --new-only --stop-after=10 elonmusk   # Stop after 10 known tweets

# Help
npm start --help
```

## Configuration

Edit `.env`:
```env
TWITTER_USERNAME=your_username    # Optional - will prompt if missing
TWITTER_PASSWORD=your_password    # Optional - will prompt if missing
PUPPETEER_HEADLESS=false         # Keep false until authenticated
VIEWPORT_WIDTH=1366              # Browser dimensions
VIEWPORT_HEIGHT=768

# Download behavior
DOWNLOAD_ORDER=newest            # newest or oldest first

# Early stop - stop when hitting already-processed tweets
EARLY_STOP_ENABLED=false         # Default: scroll entire timeline
EARLY_STOP_THRESHOLD=20          # Consecutive known tweets before stopping

# Retry settings
MAX_TWEET_RETRIES=3              # Retries for failed tweet pages
MAX_IMAGE_RETRIES=3              # Retries for failed image downloads
RETRY_BASE_DELAY=2000            # Base delay between retries (ms)
```

## Project Structure

```
src/
├── config/config.js           # App configuration
├── db/                        # SQLite database layer
│   ├── connection.js          # Database connection
│   ├── migrations.js          # Schema migrations
│   └── repositories/          # Data access
│       ├── accountRepository.js
│       ├── tweetRepository.js
│       └── imageRepository.js
├── services/
│   ├── authService.js         # Login/session handling
│   ├── browserService.js      # Puppeteer automation
│   ├── imageService.js        # Download management
│   ├── pagePoolManager.js     # Parallel browser tabs
│   ├── parallelTweetProcessor.js  # Concurrent processing
│   └── progressTracker.js     # Resume capability
├── utils/
│   ├── downloadTracker.js     # Progress tracking
│   ├── logger.js              # Console output
│   ├── fileSystem.js          # File operations
│   ├── errors.js              # Custom error types
│   └── semaphore.js           # Concurrency control
└── index.js                   # CLI entry point

data/
└── twitter_downloads.db       # SQLite database (auto-created)
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

- [x] Incremental downloads (skip already-processed tweets)
- [x] SQLite tracking for persistent state
- [x] Resume interrupted downloads
- [x] Parallel browser tabs infrastructure
- [ ] GIF and MP4 download support
- [ ] Full parallel processing mode activation

## License

MIT

---

**Disclaimer**: Respect Twitter's Terms of Service and applicable laws. This tool is for research and archival purposes.

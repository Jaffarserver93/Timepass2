# ByteNut AFK Bot

A self-contained AFK bot for bytenut.com with a live dashboard, real-browser Cloudflare bypass, WebSocket screenshot streaming, and automatic server renewal via IMAP OTP.

## Run & Operate

```bash
./start.sh          # Install deps + start bot (run from project root)
```

- Runs the bot server at `http://localhost:<PORT>` (default `3000`)
- Both the dashboard and API are served on the **same port**
- Bot auto-starts on launch; dashboard is mobile-friendly

## Stack

- **Runtime:** Node.js (CommonJS), no build step
- **Bot automation:** `puppeteer-real-browser` — real Chrome fingerprint, Cloudflare Turnstile bypass
- **Server:** Express 4 + `ws` WebSocket (single port for API + dashboard)
- **IMAP:** `imapflow` — fetches OTP emails for auto-renewal
- **Dashboard:** Vanilla HTML/CSS/JS served as static files

## Where things live

```
afk-bot/
├── src/
│   ├── server.js     — Express + WebSocket server, all API routes
│   ├── bot.js        — AFKBot class (login, renewal, scroll, screenshot)
│   └── imap.js       — IMAP OTP fetcher + test-connection helper
├── public/
│   └── index.html    — Full dashboard UI (single file)
├── .env              — Credentials (copy from .env.example)
├── .env.example      — Template with all required vars
└── package.json
start.sh              — Root-level setup + launch script
```

## Architecture decisions

- **Binary WebSocket frames for screenshots** — screenshots are sent as raw JPEG bytes (`ws.send(buf, { binary: true })`), not base64 JSON, to avoid corruption on large payloads. The client uses `URL.createObjectURL(blob)`.
- **Single-port design** — Express serves both the static dashboard and REST API; WebSocket upgrades on the same HTTP server. No proxy or CORS config needed.
- **Renewal is non-fatal** — if OTP auto-renewal fails (wrong IMAP creds, timeout, etc.) the bot logs a warning and continues running; it does not crash.
- **Vue SPA login handling** — bytenut.com is a Vue SPA (Element UI). Login submits via button click (not Enter), and success is detected by polling for URL change rather than `waitForNavigation`.
- **Xvfb on Linux** — `puppeteer-real-browser` needs a virtual display on headless Linux servers; `start.sh` auto-installs Xvfb via apt/yum/pacman.

## Product

- **AFK bot** — logs into bytenut.com, navigates to the game panel, and keeps the session alive by reloading the target page every 60 seconds
- **Live dashboard** — real-time screenshot preview at ~2 fps over WebSocket, uptime counter, reload countdown, live log feed
- **Auto-renewal** — detects "Server Paused" banner, clicks Send Code, fetches OTP from Gmail via IMAP, enters code, clicks Extend — fully automated
- **Controls** — Start / Stop / Reload Now / Scroll Up / Scroll Down buttons; IMAP connection test

## User preferences

- Both API and dashboard must run on the same port
- `start.sh` must be at the project root (not inside `afk-bot/`)
- Screenshot live preview at 500ms intervals (2 fps)
- Browser viewport: 1280 × 720
- Dashboard UI: mobile-friendly, premium dark design

## Gotchas

- **Gmail App Password required** — standard Gmail password won't work for IMAP if 2FA is on. Generate one at Google Account → Security → App Passwords.
- **IMAP OTP regex handles spaced digits** — the renewal email shows `7 6 8 2 3 3` (spaces between digits). The fetcher strips spaces before returning the code.
- **Login fields use Element UI** — selectors are `input.el-input__inner[placeholder="Username"]` and `input.el-input__inner[placeholder="Password"]`, not `input[type="email"]`.
- **Delete `node_modules/` to force reinstall** if a new dependency is added and `start.sh` doesn't pick it up.

## Required .env variables

```
EMAIL=your@bytenut-email.com
PASSWORD=yourpassword
PORT=3000

IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your@gmail.com
IMAP_PASS=your-gmail-app-password
```

---
name: AFK Bot architecture
description: Overall structure of the afk-bot project — standalone Node.js, single port, no build step
---

The bot lives in `afk-bot/` at the project root (not inside `artifacts/`). It is a standalone CommonJS Node.js app with no TypeScript and no build step — `node src/server.js` runs it directly.

**Single-port design:** Express serves the static dashboard (`public/index.html`) and all REST routes; the WebSocket server shares the same `http.Server`. No proxy or separate frontend process.

**Key files:**
- `src/server.js` — Express + WS server, all API routes, loads env vars
- `src/bot.js` — `AFKBot` class (login, Cloudflare wait, renewal, scroll, screenshot loops)
- `src/imap.js` — IMAP OTP fetcher + `testIMAP()` helper
- `public/index.html` — full dashboard (single HTML file, vanilla JS)
- `start.sh` at project **root** (not inside afk-bot/) — installs Xvfb, Chrome deps, npm packages, then runs the bot

**Why:** User specifically requested same-port design and a root-level start script for terminal use on their own machine.

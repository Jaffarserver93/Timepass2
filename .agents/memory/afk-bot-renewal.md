---
name: AFK Bot renewal non-fatal rule
description: Auto-renewal failures must never crash the bot — always catch at the call site
---

The server renewal flow (`_checkAndRenewIfPaused`) can fail for many reasons: IMAP misconfigured, OTP email delayed, "Extend" button not found, etc. Throwing from this method originally killed the entire bot.

**Rule:** Every call site of `_checkAndRenewIfPaused()` must use `.catch()` to log a warning and continue:
```js
await this._checkAndRenewIfPaused().catch((e) =>
  this.log(`Auto-renew failed (bot will continue): ${e.message}`, "warn")
);
```

This applies in `start()` and in `_startReloadLoop()` (which already had its own `.catch()`).

**Why:** The bot's primary purpose is to keep the session alive (AFK). Renewal is a secondary feature. A failed renewal should be logged visibly but must never stop the bot from running.

**How to apply:** Any new feature that runs inside the bot's main loop should follow the same pattern — wrap in try/catch and log, never throw up to `start()`.

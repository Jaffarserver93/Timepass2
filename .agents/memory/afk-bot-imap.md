---
name: AFK Bot IMAP OTP fetching
description: Definitive working pattern for IMAP OTP fetching — ported from reference open-source dashboard
---

## Working pattern (reference port)

`fetchOTP` in `imap.js` now matches the reference dashboard exactly:

1. **Fresh connect/disconnect every 5s retry** — never hold a persistent connection.
   Persistent connections don't receive new-message notifications without IDLE/NOOP,
   so the mailbox state appears frozen and newly arrived emails are invisible.

2. **`client.fetchOne(String(seq), { envelope: true, source: true, internalDate: true })`**
   — NO third `{ uid: true }` argument. Passing `{ uid: true }` as third arg causes
   silent `null` returns on many IMAP servers (confirmed broken on bytenut's mail server).

3. **`client.search({ since: last 10 min })`** — NO from filter in IMAP search.
   Some servers don't index FROM correctly; filter in JS by checking from/subject/raw
   for "bytenut" or "verification".

4. **OTP extraction: `subject.match(/\b(\d{6})\b/)` first, then `raw.match(/\b(\d{6})\b/)`**
   — simple scan of the full raw source works. Subject line contains code directly:
   `"Verification Code 095009"`. No complex HTML parsing needed.

5. **Time guard**: `msg.internalDate` compared to `sentAfter` (15s tolerance) to skip
   emails that arrived before clicking Send Code.

**Why UID baseline alone wasn't enough:** `getUIDNext()` still exists and is called in
bot.js before the Turnstile wait, but it's now only used as a reference — the internalDate
check replaces it as the primary time guard. The real fix was the connection/fetchOne pattern.

**How to apply:** If OTP ever breaks again, first confirm the connection pattern matches
the reference above. The `{ uid: true }` third arg to fetchOne is the most likely culprit.
`testIMAP()` exposed as `POST /api/test-imap` for connection verification.

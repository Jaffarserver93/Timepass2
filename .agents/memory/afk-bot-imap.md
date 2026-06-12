---
name: AFK Bot IMAP OTP fetching
description: Definitive working pattern for IMAP OTP fetching from bytenut.com emails
---

## Working pattern

`fetchOTP` in `imap.js` uses fresh connect/disconnect for every 5s retry attempt.

### fetchOne call
```js
client.fetchOne(String(seq), { envelope: true, source: true, internalDate: true })
```
**NO third `{ uid: true }` argument** — causes silent null returns on some servers.

### Search
```js
client.search({ since: new Date(Date.now() - 10 * 60 * 1000) })
```
No from filter. Filter in JS by checking from/subject/raw for "bytenut"/"verification".

### OTP extraction — CRITICAL
The bytenut email HTML contains CSS color codes `#212529` and `#495057` in a `<style>` block.
These appear **before** the real OTP in the raw source. Any simple `raw.match(/\b(\d{6})\b/)`
will always return `212529` (wrong) instead of the OTP.

**Correct approach:**
1. Decode quoted-printable (`=\r\n`, `=XX` sequences)
2. Strip all HTML tags (`<[^>]+>`)
3. Match `/verification\s+code\s+(\d{6})/i` — anchored to the label

The real OTP appears in plain text as: `Verification Code 095009`

Fallback: `/(?<!#)\b(\d{6})\b/` — excludes sequences preceded by `#`.

### Subject line
Subject is `【ByteNut】 Free Server Renewal Verification` — **NO OTP in subject**.
Do not rely on subject extraction for bytenut.

### Time guard
`msg.internalDate` compared to `sentAfter` (15s tolerance) to skip pre-existing emails.
`getUIDNext()` still exported for use in bot.js before Turnstile wait.

### testIMAP()
Exposed as `POST /api/test-imap` for connection verification.

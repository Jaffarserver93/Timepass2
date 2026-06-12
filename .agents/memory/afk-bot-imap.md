---
name: AFK Bot IMAP OTP fetching
description: OTP email from bytenut has spaced digits; three-strategy regex + quoted-printable decode needed
---

The renewal OTP email from `noreply@bytenut.com` displays the code as **`7 6 8 2 3 3`** (single spaces between each digit), not `768233`. A simple `\b(\d{6})\b` regex misses this.

**Three-strategy extraction in `_extractOTP()`:**
1. `\b(\d{6})\b` — six consecutive digits (no spaces)
2. `(\d[\s]{0,2}){6}` — digits separated by spaces → strip spaces → verify length 6
3. Wide fallback `(\d\s?){6}` → strip whitespace → verify length 6

**Quoted-printable decode** runs first — emails often encode `=3D`, soft line breaks (`=\r\n`), and non-breaking spaces (`\u00a0`). Without this, the regex may fail to match even when the code is present.

**IMAP approach:** Uses `imapflow`. `fetchOTP` now accepts `sentAfter` (ms timestamp) — always pass `Date.now()` captured **before** clicking "Send Code". This ensures IMAP only searches emails that arrived after the click, preventing stale OTP reuse. Falls back to 3-minute window if `sentAfter` not provided. Fetches full `source` of the message (most reliable — avoids bodyPart encoding issues). Retries every 5 seconds for up to 2 minutes.

**OTP extraction improvements (2026-06-12):** Strips HTML tags before matching (important — code is inside HTML email). Strategy 1 uses negative lookbehind/lookahead `(?<!\d)(\d{6})(?!\d)` to avoid matching within 7+ digit sequences (message IDs, dates). Strategy 2 requires exactly `\d( \d){5}` pattern. Strategy 3 anchors to keyword context ("code", "verification", "otp") within 80 chars.

**`testIMAP()`** — exposed as `POST /api/test-imap`; opens INBOX, reports message count. Used in dashboard "Test Connection" button.

**How to apply:** If OTP extraction ever fails again, first check the raw email body format and add a new strategy to `_extractOTP()`.

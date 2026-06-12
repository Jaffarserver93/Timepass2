const { ImapFlow } = require("imapflow");

/**
 * Returns the UIDNEXT value of INBOX — the UID that will be assigned to the
 * NEXT arriving message. Call this BEFORE clicking "Send Code" so that any
 * email with uid >= this value is guaranteed to be a fresh, new message.
 */
async function getUIDNext({ host, port, user, pass }) {
  const portNum = parseInt(port);
  const secure = portNum === 993 || portNum === 465;
  const client = new ImapFlow({
    host, port: portNum, secure,
    auth: { user, pass },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    const uidNext = client.mailbox.uidNext;
    lock.release();
    return uidNext;
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Waits for a new OTP email with UID >= minUid (captured before clicking
 * "Send Code"). Retries every 5 seconds for up to `timeout` ms.
 */
async function fetchOTP({ host, port, user, pass, sender = "noreply@bytenut.com", timeout = 120000, minUid = null, sentAfter = null }) {
  const portNum = parseInt(port);
  const secure = portNum === 993 || portNum === 465;

  const client = new ImapFlow({
    host, port: portNum, secure,
    auth: { user, pass },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // IMAP SINCE is day-granularity only — use yesterday to limit result set,
      // real filtering is done by UID below
      const searchAfter = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        const uids = await client.search(
          { from: sender, since: searchAfter },
          { uid: true }
        ).catch(() => []);

        if (uids && uids.length > 0) {
          // Process newest first (highest UID = most recently received)
          const sorted = [...uids].sort((a, b) => b - a);

          for (const uid of sorted) {
            // Primary guard: skip any UID that existed before we clicked "Send Code"
            if (minUid != null && uid < minUid) {
              continue;
            }

            // Fetch envelope (subject + from) AND source in one round-trip
            const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true })
              .catch(() => null);
            if (!msg) continue;

            // Secondary guard: verify sender matches
            const fromAddr = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
            if (!fromAddr.includes("bytenut")) continue;

            const subject = msg.envelope?.subject ?? "";
            const raw = msg.source?.toString("utf8") ?? "";

            // Strategy A: OTP is often in the subject line directly
            // e.g. "894654 is your verification code" or "Verification: 894654"
            const subjectOtp = _extractDigits(subject);
            if (subjectOtp) return subjectOtp;

            // Strategy B: Parse the HTML body — look near VERIFICATION CODE section
            const bodyOtp = _extractOTP(raw);
            if (bodyOtp) return bodyOtp;
          }
        }

        await sleep(5000);
      }

      throw new Error("OTP email not received within timeout (2 minutes). Check IMAP credentials and spam folder.");
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Extract a 6-digit code from a short string (like an email subject).
 * Subject lines: "894654 is your verification code" or "Your code: 894654"
 */
function _extractDigits(text) {
  if (!text) return null;
  const m = text.match(/\b(\d{6})\b/);
  return m ? m[1] : null;
}

/**
 * Extract OTP from raw email source.
 * Strategy: find the VERIFICATION CODE section first, then grab the 6 digits.
 * This prevents matching static numbers (user IDs, tracking IDs) elsewhere in
 * the email template.
 */
function _extractOTP(raw) {
  if (!raw) return null;

  // Decode quoted-printable soft line breaks and encoded chars
  const decoded = raw
    .replace(/=\r?\n/g, "")
    .replace(/=[0-9A-Fa-f]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(1), 16)))
    .replace(/\u00a0/g, " ");

  // Strip HTML tags and decode common entities to get clean plain text
  const plain = decoded
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");

  // Priority 1: code appears directly after "VERIFICATION CODE" label
  // Matches: "VERIFICATION CODE 894654" or "VERIFICATION CODE\n8 9 4 6 5 4"
  const vcMatch = plain.match(/VERIFICATION\s+CODE\s+([\d\s]{6,17})/i);
  if (vcMatch) {
    const digits = vcMatch[1].replace(/\s/g, "");
    if (digits.length === 6) return digits;
    // Handle spaced digits: "8 9 4 6 5 4" → "894654"
    const compact = digits.slice(0, 6);
    if (/^\d{6}$/.test(compact)) return compact;
  }

  // Priority 2: 6 spaced single digits immediately after a keyword
  // e.g. "code 8 9 4 6 5 4" or "code is 8 9 4 6 5 4"
  const spacedMatch = plain.match(/(?:code|otp|token)\s+(?:is\s+)?(\d(?:\s\d){5})/i);
  if (spacedMatch) {
    return spacedMatch[1].replace(/\s/g, "");
  }

  // Priority 3: any isolated 6-digit group, but ONLY if preceded/followed by
  // verification-related context within 120 chars
  const ctxMatch = plain.match(/(?:verif|renew|code|otp)[^]{0,120}(?<!\d)(\d{6})(?!\d)/i);
  if (ctxMatch) return ctxMatch[1];

  // Priority 4: last-resort — take the 6-digit group that appears AFTER any
  // colon or "code" keyword, avoiding static IDs in URLs/headers
  const afterColon = plain.match(/[Cc]ode[^:]{0,20}:\s*(\d{6})\b/);
  if (afterColon) return afterColon[1];

  return null;
}

/**
 * Test IMAP connection — returns { ok, message }
 */
async function testIMAP({ host, port, user, pass }) {
  if (!host || !user || !pass) {
    return { ok: false, message: "IMAP credentials not configured in .env" };
  }

  const portNum = parseInt(port) || 993;
  const secure = portNum === 993 || portNum === 465;

  const client = new ImapFlow({
    host, port: portNum, secure,
    auth: { user, pass },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    const info = client.mailbox;
    lock.release();
    await client.logout().catch(() => {});
    return { ok: true, message: `Connected to ${host} — INBOX has ${info?.exists ?? "?"} messages` };
  } catch (err) {
    return { ok: false, message: `IMAP error: ${err.message}` };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { fetchOTP, testIMAP, getUIDNext };

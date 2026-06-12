const { ImapFlow } = require("imapflow");

/**
 * Fetches the latest OTP from noreply@bytenut.com via IMAP.
 * Handles digits with or without spaces (e.g. "768233" or "7 6 8 2 3 3").
 * Retries every 5 seconds for up to `timeout` ms.
 */
async function fetchOTP({ host, port, user, pass, sender = "noreply@bytenut.com", timeout = 120000, sentAfter = null }) {
  const portNum = parseInt(port);
  const secure = portNum === 993 || portNum === 465;

  const client = new ImapFlow({
    host,
    port: portNum,
    secure,
    auth: { user, pass },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Use sentAfter if provided (set to just before Send Code was clicked),
      // otherwise fall back to 3 minutes ago (not 10) to avoid stale OTPs
      const searchAfter = sentAfter
        ? new Date(sentAfter - 5000)   // 5 sec buffer before click
        : new Date(Date.now() - 3 * 60 * 1000);
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        const uids = await client.search(
          { from: sender, since: searchAfter },
          { uid: true }
        ).catch(() => []);

        if (uids && uids.length > 0) {
          // Process newest first
          const sorted = [...uids].reverse();

          for (const uid of sorted) {
            // IMPORTANT: IMAP SINCE is day-granularity only (RFC 3501) — it
            // cannot filter by time-of-day. We must check INTERNALDATE on each
            // message to discard emails that arrived before we clicked Send Code.
            const internalDate = await _fetchInternalDate(client, uid);
            if (internalDate && sentAfter && internalDate.getTime() < (sentAfter - 5000)) {
              // This email is older than our Send Code click — skip it
              continue;
            }

            const source = await _fetchSource(client, uid);
            if (!source) continue;

            const otp = _extractOTP(source);
            if (otp) return otp;
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
 * Test IMAP connection — returns { ok, message }
 */
async function testIMAP({ host, port, user, pass }) {
  if (!host || !user || !pass) {
    return { ok: false, message: "IMAP credentials not configured in .env" };
  }

  const portNum = parseInt(port) || 993;
  const secure = portNum === 993 || portNum === 465;

  const client = new ImapFlow({
    host,
    port: portNum,
    secure,
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

async function _fetchInternalDate(client, uid) {
  try {
    for await (const msg of client.fetch(`${uid}`, { internalDate: true }, { uid: true })) {
      if (msg.internalDate) return new Date(msg.internalDate);
    }
  } catch (_) {}
  return null;
}

async function _fetchSource(client, uid) {
  try {
    for await (const msg of client.fetch(`${uid}`, { source: true }, { uid: true })) {
      if (msg.source) return msg.source.toString("utf8");
    }
  } catch (_) {}
  return null;
}

function _extractOTP(raw) {
  // Decode quoted-printable (=3D etc) and line-breaks
  const decoded = raw
    .replace(/=\r?\n/g, "")              // soft line breaks
    .replace(/=[0-9A-Fa-f]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(1), 16)))
    .replace(/\u00a0/g, " ");            // normalize non-breaking spaces

  // Strip HTML tags to get plain text before matching
  const plain = decoded.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ");

  // Strategy 1: six consecutive digits NOT part of a longer number (e.g. 894654)
  // Use negative lookbehind/lookahead to avoid matching inside 7+ digit sequences
  const m1 = plain.match(/(?<!\d)(\d{6})(?!\d)/);
  if (m1) return m1[1];

  // Strategy 2: digits separated by single spaces (e.g. "8 9 4 6 5 4")
  // Must be exactly 6 single digits each separated by one space
  const m2 = plain.match(/(?<!\d)\d( \d){5}(?!\d)/);
  if (m2) {
    const digits = m2[0].replace(/ /g, "");
    if (digits.length === 6) return digits;
  }

  // Strategy 3: digits with optional whitespace — only inside a verification context
  // Look for the code near keywords like "code", "verification", "OTP"
  const ctxMatch = plain.match(/(?:code|verification|otp)[^\d]{0,80}((?:\d[\s]{0,2}){6})/i);
  if (ctxMatch) {
    const digits = ctxMatch[1].replace(/\s/g, "");
    if (digits.length === 6) return digits;
  }

  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { fetchOTP, testIMAP };

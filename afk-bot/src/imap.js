const { ImapFlow } = require("imapflow");

/**
 * Fetches the latest OTP from noreply@bytenut.com via IMAP.
 * Handles digits with or without spaces (e.g. "768233" or "7 6 8 2 3 3").
 * Retries every 5 seconds for up to `timeout` ms.
 */
async function fetchOTP({ host, port, user, pass, sender = "noreply@bytenut.com", timeout = 120000 }) {
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
      // Search window: emails received in the last 10 minutes
      const searchAfter = new Date(Date.now() - 10 * 60 * 1000);
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
    .replace(/=[0-9A-Fa-f]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(1), 16)));

  // Strategy 1: six consecutive digits (e.g. 768233)
  const m1 = decoded.match(/\b(\d{6})\b/);
  if (m1) return m1[1];

  // Strategy 2: digits separated by spaces (e.g. "7 6 8 2 3 3")
  const m2 = decoded.match(/\b(\d[\s\u00a0]{0,2}){6}\b/);
  if (m2) {
    const digits = m2[0].replace(/[\s\u00a0]/g, "");
    if (digits.length === 6) return digits;
  }

  // Strategy 3: wider scan for any 6-digit group
  const m3 = decoded.match(/(\d\s?){6}/);
  if (m3) {
    const digits = m3[0].replace(/\s/g, "");
    if (digits.length === 6) return digits;
  }

  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { fetchOTP, testIMAP };

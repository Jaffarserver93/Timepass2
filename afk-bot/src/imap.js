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
 * Waits for a new OTP email from `sender` with UID >= minUid (captured before
 * clicking Send Code). Retries every 5 seconds for up to `timeout` ms.
 *
 * minUid is the primary guard — it is UID-based and immune to clock skew.
 * sentAfter is a secondary sanity check (INTERNALDATE >= sentAfter).
 */
async function fetchOTP({ host, port, user, pass, sender = "noreply@bytenut.com", timeout = 120000, minUid = null, sentAfter = null }) {
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
      // IMAP SINCE is day-granularity only (RFC 3501), so use today's date
      // purely to limit the result set — real filtering is done by UID below.
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
            // Primary guard: skip any email that existed before we clicked
            // "Send Code". Only UIDs >= minUid are from this session.
            if (minUid != null && uid < minUid) {
              continue;
            }

            // Secondary guard: INTERNALDATE must be >= sentAfter (handles
            // the rare case where UIDNEXT wasn't available)
            if (sentAfter) {
              const internalDate = await _fetchInternalDate(client, uid);
              if (internalDate && internalDate.getTime() < (sentAfter - 10000)) {
                continue;
              }
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
    .replace(/=\r?\n/g, "")
    .replace(/=[0-9A-Fa-f]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(1), 16)))
    .replace(/\u00a0/g, " ");

  // Strip HTML tags to get plain text before matching
  const plain = decoded.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ");

  // Strategy 1: six consecutive digits NOT part of a longer number
  const m1 = plain.match(/(?<!\d)(\d{6})(?!\d)/);
  if (m1) return m1[1];

  // Strategy 2: digits separated by single spaces (e.g. "5 7 1 4 3 0")
  const m2 = plain.match(/(?<!\d)\d( \d){5}(?!\d)/);
  if (m2) {
    const digits = m2[0].replace(/ /g, "");
    if (digits.length === 6) return digits;
  }

  // Strategy 3: digits near verification keywords
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

module.exports = { fetchOTP, testIMAP, getUIDNext };

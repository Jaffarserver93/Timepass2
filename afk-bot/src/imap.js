const { ImapFlow } = require("imapflow");

/**
 * Returns the UIDNEXT value of INBOX — the UID that will be assigned to the
 * NEXT arriving message. Call this BEFORE clicking "Send Code".
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
 * Single attempt: connect fresh, search last 10 min, find bytenut OTP email.
 * Returns the OTP string or null if not found.
 * Ported directly from the reference open-source dashboard implementation.
 */
async function _tryFetchOTP({ host, port, user, pass, sentAfter }) {
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

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Search ALL emails in the last 10 minutes — no from filter.
      // Reference uses no from filter; some servers don't index FROM correctly.
      const since = new Date(Date.now() - 10 * 60 * 1000);
      const allRecent = await client.search({ since });

      if (!allRecent || allRecent.length === 0) return null;

      // Newest first, check up to 10 most recent
      const toCheck = [...allRecent].reverse().slice(0, 10);

      for (const seq of toCheck) {
        // fetchOne with NO third argument — exactly as the reference does it.
        // Passing { uid: true } as third arg causes silent failures on some servers.
        const msg = await client.fetchOne(String(seq), {
          envelope: true,
          source: true,
          internalDate: true,
        });
        if (!msg) continue;

        const fromName    = (msg.envelope?.from?.[0]?.name    ?? "").toLowerCase();
        const fromAddr    = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const subject     = msg.envelope?.subject ?? "";
        const raw         = msg.source?.toString() ?? "";

        // Only process bytenut.com emails
        const isBytenut =
          fromAddr.includes("bytenut") ||
          fromName.includes("bytenut") ||
          subject.toLowerCase().includes("bytenut") ||
          subject.toLowerCase().includes("verification") ||
          raw.toLowerCase().includes("bytenut");

        if (!isBytenut) continue;

        // Time guard: skip emails that arrived before we clicked Send Code
        if (sentAfter && msg.internalDate) {
          const arrived = new Date(msg.internalDate).getTime();
          if (arrived < sentAfter - 15000) continue; // 15s tolerance
        }

        // Decode quoted-printable and strip HTML to get clean plain text.
        // IMPORTANT: bytenut email has CSS color codes like #212529 and #495057
        // in <style> blocks — simple raw.match(/\d{6}/) always hits those first.
        // We must strip HTML first and then anchor the search to "Verification Code".
        const decoded = raw
          .replace(/=\r?\n/g, "")
          .replace(/=[0-9A-Fa-f]{2}/g, m => String.fromCharCode(parseInt(m.slice(1), 16)));
        const plain = decoded
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/\s+/g, " ");

        // Primary: "Verification Code 095009" — the OTP always follows this label
        const vcMatch = plain.match(/verification\s+code\s+(\d{6})/i);
        if (vcMatch) return vcMatch[1];

        // Fallback: any 6-digit sequence NOT preceded by # (excludes CSS hex colors)
        const bodyMatch = plain.match(/(?<!#)\b(\d{6})\b/);
        if (bodyMatch) return bodyMatch[1];
      }

      return null;
    } finally {
      lock.release();
    }
  } catch (_) {
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Retries _tryFetchOTP every 5 seconds until OTP is found or timeout expires.
 * Fresh IMAP connection on every attempt — avoids stale-connection/cache issues.
 */
async function fetchOTP({ host, port, user, pass, timeout = 120000, sentAfter = null, minUid = null }) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const otp = await _tryFetchOTP({ host, port, user, pass, sentAfter });
    if (otp) return otp;
    await sleep(5000);
  }

  throw new Error("OTP email not received within timeout (2 minutes). Check IMAP credentials and spam folder.");
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

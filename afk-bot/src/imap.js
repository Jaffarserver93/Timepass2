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
 * Returns the OTP string or null if not found yet.
 */
async function _tryFetchOTP({ host, port, user, pass, sentAfter, log }) {
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
      // Search ALL emails in the last 10 minutes
      const since = new Date(Date.now() - 10 * 60 * 1000);
      const allRecent = await client.search({ since });
      log(`IMAP: found ${allRecent ? allRecent.length : 0} email(s) in last 10 min`);

      if (!allRecent || allRecent.length === 0) return null;

      // Newest first, check up to 10
      const toCheck = [...allRecent].reverse().slice(0, 10);

      for (const seq of toCheck) {
        const msg = await client.fetchOne(String(seq), {
          envelope: true,
          source: true,
          internalDate: true,
        });

        if (!msg) {
          log(`IMAP: seq ${seq} → fetchOne returned null, skipping`);
          continue;
        }

        const fromAddr = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const fromName = (msg.envelope?.from?.[0]?.name ?? "").toLowerCase();
        const subject  = msg.envelope?.subject ?? "";
        const rawLen   = msg.source ? msg.source.length : 0;

        log(`IMAP: seq ${seq} | from: ${fromAddr} | subject: "${subject}" | rawLen: ${rawLen}`);

        // Only process bytenut emails
        const isBytenut =
          fromAddr.includes("bytenut") ||
          fromName.includes("bytenut") ||
          subject.toLowerCase().includes("bytenut") ||
          subject.toLowerCase().includes("verification") ||
          (msg.source && msg.source.toString().toLowerCase().includes("bytenut"));

        if (!isBytenut) {
          log(`IMAP: seq ${seq} → not a bytenut email, skipping`);
          continue;
        }

        // Time guard: skip emails that arrived before we clicked Send Code
        if (sentAfter && msg.internalDate) {
          const arrived = new Date(msg.internalDate).getTime();
          const diff = arrived - sentAfter;
          log(`IMAP: seq ${seq} → arrived ${diff > 0 ? "+" : ""}${Math.round(diff/1000)}s relative to Send Code click`);
          if (arrived < sentAfter - 30000) {
            log(`IMAP: seq ${seq} → too old (arrived >30s before Send Code), skipping`);
            continue;
          }
        }

        // Decode quoted-printable + strip HTML
        const raw = msg.source ? msg.source.toString() : "";
        const decoded = raw
          .replace(/=\r?\n/g, "")
          .replace(/=[0-9A-Fa-f]{2}/g, m => String.fromCharCode(parseInt(m.slice(1), 16)));
        const plain = decoded
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/\s+/g, " ");

        // Primary: "Verification Code 095009"
        const vcMatch = plain.match(/verification\s+code\s+(\d{6})/i);
        if (vcMatch) {
          log(`IMAP: seq ${seq} → OTP found via "Verification Code" label: ${vcMatch[1]}`);
          return vcMatch[1];
        }

        // Fallback: any 6-digit number NOT preceded by # (excludes CSS hex colors)
        const bodyMatch = plain.match(/(?<!#)\b(\d{6})\b/);
        if (bodyMatch) {
          log(`IMAP: seq ${seq} → OTP found via body fallback: ${bodyMatch[1]}`);
          return bodyMatch[1];
        }

        log(`IMAP: seq ${seq} → bytenut email found but no 6-digit OTP extracted`);
      }

      return null;
    } finally {
      lock.release();
    }
  } catch (err) {
    log(`IMAP: connection/fetch error — ${err.message}`);
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Retries _tryFetchOTP every 5 seconds until OTP is found or timeout expires.
 * Fresh IMAP connection on every attempt — avoids stale-connection cache issues.
 * Pass log function to see per-attempt details in the dashboard.
 */
async function fetchOTP({ host, port, user, pass, timeout = 120000, sentAfter = null, minUid = null, log = console.log }) {
  const deadline = Date.now() + timeout;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const remaining = Math.round((deadline - Date.now()) / 1000);
    log(`IMAP: attempt ${attempt} (${remaining}s remaining)...`);

    const otp = await _tryFetchOTP({ host, port, user, pass, sentAfter, log });
    if (otp) return otp;

    if (Date.now() < deadline) await sleep(5000);
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

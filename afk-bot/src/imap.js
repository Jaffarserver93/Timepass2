const { ImapFlow } = require("imapflow");

/**
 * Fetches the latest OTP email from the given sender and extracts a 6-digit code.
 * Retries every 4 seconds for up to `timeout` ms.
 */
async function fetchOTP({ host, port, user, pass, sender = "noreply@bytenut.com", timeout = 120000 }) {
  const secure = parseInt(port) === 993 || parseInt(port) === 465;

  const client = new ImapFlow({
    host,
    port: parseInt(port),
    secure,
    auth: { user, pass },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const deadline = Date.now() + timeout;
      const searchAfter = new Date(Date.now() - 5 * 60 * 1000); // last 5 min

      while (Date.now() < deadline) {
        // Search for emails from the sender received in the last 5 minutes
        const uids = await client.search({ from: sender, since: searchAfter }, { uid: true });

        if (uids && uids.length > 0) {
          // Get the most recent message
          const latestUid = uids[uids.length - 1];
          let fullBody = "";

          for await (const msg of client.fetch(`${latestUid}`, { bodyParts: ["TEXT"], envelope: true }, { uid: true })) {
            if (msg.bodyParts) {
              for (const [, buf] of msg.bodyParts) {
                fullBody += buf.toString("utf8");
              }
            }
          }

          // Also try source if bodyParts didn't work
          if (!fullBody) {
            for await (const msg of client.fetch(`${latestUid}`, { source: true }, { uid: true })) {
              if (msg.source) fullBody = msg.source.toString("utf8");
            }
          }

          // Extract 6-digit OTP from body
          const match = fullBody.match(/\b(\d{6})\b/);
          if (match) return match[1];
        }

        // Wait before retrying
        await sleep(4000);
      }

      throw new Error("OTP email not received within timeout (2 minutes)");
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { fetchOTP };

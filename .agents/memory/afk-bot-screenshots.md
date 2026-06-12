---
name: AFK Bot screenshot streaming
description: Why screenshots use binary WS frames instead of base64 JSON, and how the client handles them
---

**Problem:** Sending JPEG screenshots as base64-encoded JSON strings over WebSocket produces broken images. A single JPEG frame at 1280×720 @ quality 60 is ~80-150 KB; encoding to base64 adds ~33% overhead and large JSON text frames can get corrupted or truncated.

**Solution:** Send raw binary frames via WebSocket:
- Server: `ws.send(Buffer.from(buf), { binary: true })`
- Client: `ws.binaryType = "blob"` then `if (e.data instanceof Blob)` — create an object URL with `URL.createObjectURL(blob)` and revoke the previous one on `img.onload` to prevent memory leaks.

Text JSON frames (status, logs) are still sent normally; the client differentiates by checking `e.data instanceof Blob`.

**Why:** This is the correct approach for any real-time image/binary streaming over WebSocket.

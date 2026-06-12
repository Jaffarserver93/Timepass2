require("dotenv").config();

const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");
const AFKBot = require("./bot");
const { testIMAP } = require("./imap");

const PORT = parseInt(process.env.PORT || "3000", 10);
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("[ERROR] EMAIL and PASSWORD must be set in .env file");
  process.exit(1);
}

const imapConfig = {
  host: process.env.IMAP_HOST || "",
  port: process.env.IMAP_PORT || "993",
  user: process.env.IMAP_USER || "",
  pass: process.env.IMAP_PASS || "",
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const logs = [];
const MAX_LOGS = 200;

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

const bot = new AFKBot({
  email: EMAIL,
  password: PASSWORD,
  imapConfig,
  onScreenshot: (buf) => {
    const frame = Buffer.from(buf);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(frame, { binary: true });
    });
  },
  onLog: (entry) => {
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    broadcast("log", entry);
  },
  onStatusChange: (state) => {
    broadcast("status", state);
  },
});

// ── REST API ────────────────────────────────────────────────────────────────

app.get("/api/status", (req, res) => res.json(bot.getState()));
app.get("/api/logs", (req, res) => res.json(logs));

app.post("/api/start", async (req, res) => {
  if (bot.running) return res.json({ ok: false, message: "Bot already running" });
  bot.start().catch(() => {});
  res.json({ ok: true, message: "Bot starting..." });
});

app.post("/api/stop", async (req, res) => {
  await bot.stop();
  res.json({ ok: true, message: "Bot stopped" });
});

app.post("/api/reload", async (req, res) => {
  const ok = await bot.forceReload();
  res.json({ ok, message: ok ? "Page reloaded" : "Bot not running" });
});

app.post("/api/scroll", async (req, res) => {
  const direction = req.body.direction === "up" ? "up" : "down";
  const amount = parseInt(req.body.amount) || 300;
  const ok = await bot.scroll(direction, amount);
  res.json({ ok, message: ok ? `Scrolled ${direction}` : "Bot not running or page unavailable" });
});

app.post("/api/test-imap", async (req, res) => {
  const result = await testIMAP(imapConfig).catch((err) => ({ ok: false, message: err.message }));
  res.json(result);
});

// ── WebSocket ───────────────────────────────────────────────────────────────

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "status", data: bot.getState() }));
  logs.slice(-50).forEach((l) => ws.send(JSON.stringify({ type: "log", data: l })));
});

// ── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n┌─────────────────────────────────────────┐`);
  console.log(`│  AFK Bot Dashboard running on port ${PORT}   │`);
  console.log(`│  Open http://localhost:${PORT} in browser   │`);
  console.log(`└─────────────────────────────────────────┘\n`);
  console.log(`  Target: https://www.bytenut.com/free-gamepanel/87079436`);
  console.log(`  Auto-reload every: 60 seconds`);
  console.log(`  Screenshot interval: 500ms`);
  console.log(`  IMAP host: ${imapConfig.host || "(not set — OTP auto-renew disabled)"}\n`);

  console.log("Auto-starting bot...");
  bot.start().catch((err) => console.error("Bot start error:", err));
});

process.on("SIGINT", async () => { console.log("\nShutting down..."); await bot.stop(); process.exit(0); });
process.on("SIGTERM", async () => { await bot.stop(); process.exit(0); });

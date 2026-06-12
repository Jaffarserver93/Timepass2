const puppeteer = require("puppeteer");

const LOGIN_URL = "https://www.bytenut.com/auth/login";
const TARGET_URL = "https://www.bytenut.com/free-gamepanel/87079436";
const RELOAD_INTERVAL_MS = 60 * 1000;
const SCREENSHOT_INTERVAL_MS = 100;

class AFKBot {
  constructor({ email, password, onScreenshot, onLog, onStatusChange }) {
    this.email = email;
    this.password = password;
    this.onScreenshot = onScreenshot || (() => {});
    this.onLog = onLog || (() => {});
    this.onStatusChange = onStatusChange || (() => {});

    this.browser = null;
    this.page = null;
    this.running = false;
    this.startTime = null;
    this.reloadCount = 0;
    this.screenshotLoop = null;
    this.reloadLoop = null;
    this.status = "stopped";
    this.lastError = null;
  }

  log(msg, level = "info") {
    const ts = new Date().toISOString();
    const entry = { ts, level, msg };
    console.log(`[${ts}] [${level.toUpperCase()}] ${msg}`);
    this.onLog(entry);
  }

  setStatus(status) {
    this.status = status;
    this.onStatusChange({ status, startTime: this.startTime, reloadCount: this.reloadCount, lastError: this.lastError });
  }

  getState() {
    return {
      status: this.status,
      startTime: this.startTime,
      reloadCount: this.reloadCount,
      lastError: this.lastError,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
    };
  }

  async start() {
    if (this.running) {
      this.log("Bot is already running", "warn");
      return;
    }

    this.running = true;
    this.lastError = null;
    this.setStatus("launching");
    this.log("Launching browser...");

    try {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--window-size=1280,800",
        ],
        defaultViewport: { width: 1280, height: 800 },
      });

      this.page = await this.browser.newPage();

      await this.page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      );

      this.log("Browser launched. Navigating to login page...");
      this.setStatus("logging_in");

      await this.page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });
      this.log("Login page loaded. Filling credentials...");

      await this.page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="mail" i], input[id*="email" i]', { timeout: 10000 });

      const emailSelector = await this.page.$('input[type="email"]') ||
        await this.page.$('input[name="email"]') ||
        await this.page.$('input[placeholder*="mail" i]') ||
        await this.page.$('input[id*="email" i]');

      if (!emailSelector) throw new Error("Could not find email input field");

      await this.page.click('input[type="email"], input[name="email"], input[placeholder*="mail" i], input[id*="email" i]');
      await this.page.keyboard.down("Control");
      await this.page.keyboard.press("a");
      await this.page.keyboard.up("Control");
      await this.page.type('input[type="email"], input[name="email"], input[placeholder*="mail" i], input[id*="email" i]', this.email, { delay: 40 });

      const passField = await this.page.$('input[type="password"]');
      if (!passField) throw new Error("Could not find password input field");
      await passField.click();
      await passField.type(this.password, { delay: 40 });

      this.log("Credentials filled. Submitting login form...");

      await Promise.all([
        this.page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
        this.page.keyboard.press("Enter"),
      ]);

      const currentUrl = this.page.url();
      this.log(`Login successful. Current URL: ${currentUrl}`);

      this.log(`Navigating to AFK target: ${TARGET_URL}`);
      this.setStatus("navigating");

      await this.page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 30000 });
      this.log("AFK target page loaded. Bot is now active!");

      this.startTime = Date.now();
      this.reloadCount = 0;
      this.setStatus("running");

      this._startScreenshotLoop();
      this._startReloadLoop();

    } catch (err) {
      this.lastError = err.message;
      this.log(`Bot error: ${err.message}`, "error");
      this.setStatus("error");
      await this.stop();
    }
  }

  _startScreenshotLoop() {
    this.screenshotLoop = setInterval(async () => {
      if (!this.page || !this.running) return;
      try {
        const buf = await this.page.screenshot({ type: "jpeg", quality: 60 });
        this.onScreenshot(buf);
      } catch (_) {}
    }, SCREENSHOT_INTERVAL_MS);
  }

  _startReloadLoop() {
    this.reloadLoop = setInterval(async () => {
      if (!this.page || !this.running) return;
      try {
        this.log("Reloading AFK target page...");
        await this.page.reload({ waitUntil: "networkidle2", timeout: 20000 });
        this.reloadCount++;
        this.log(`Page reloaded. Total reloads: ${this.reloadCount}`);
        this.onStatusChange(this.getState());
      } catch (err) {
        this.log(`Reload failed: ${err.message}`, "warn");
      }
    }, RELOAD_INTERVAL_MS);
  }

  async stop() {
    this.running = false;
    if (this.screenshotLoop) { clearInterval(this.screenshotLoop); this.screenshotLoop = null; }
    if (this.reloadLoop) { clearInterval(this.reloadLoop); this.reloadLoop = null; }
    if (this.browser) {
      try { await this.browser.close(); } catch (_) {}
      this.browser = null;
      this.page = null;
    }
    if (this.status !== "error") this.setStatus("stopped");
    this.log("Bot stopped.");
  }

  async forceReload() {
    if (!this.page || !this.running) return false;
    try {
      await this.page.reload({ waitUntil: "networkidle2", timeout: 20000 });
      this.reloadCount++;
      this.log("Manual reload triggered.");
      this.onStatusChange(this.getState());
      return true;
    } catch (err) {
      this.log(`Manual reload failed: ${err.message}`, "warn");
      return false;
    }
  }
}

module.exports = AFKBot;

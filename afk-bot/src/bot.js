const { connect } = require("puppeteer-real-browser");

const LOGIN_URL = "https://www.bytenut.com/auth/login";
const TARGET_URL = "https://www.bytenut.com/free-gamepanel/87079436";
const RELOAD_INTERVAL_MS = 60 * 1000;
const SCREENSHOT_INTERVAL_MS = 500;

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
    this.onStatusChange({
      status,
      startTime: this.startTime,
      reloadCount: this.reloadCount,
      lastError: this.lastError,
    });
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
    this.log("Launching real browser (Cloudflare bypass enabled)...");

    try {
      const result = await connect({
        headless: "auto",
        turnstile: true,
        fingerprint: true,
        disableXvfb: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--window-size=1280,720",
        ],
        connectOption: {
          defaultViewport: { width: 1280, height: 720 },
        },
      });

      this.browser = result.browser;
      this.page = result.page;

      this.log("Browser launched. Navigating to login page...");
      this.setStatus("logging_in");

      await this.page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
      this.log("Login page loaded. Waiting for Cloudflare check to pass...");

      await this._waitForCloudflare();
      this.log("Cloudflare passed. Filling credentials...");

      await this._fillLogin();

      this.log(`Navigating to AFK target: ${TARGET_URL}`);
      this.setStatus("navigating");

      await this.page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60000 });
      await this._waitForCloudflare();
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

  async _waitForCloudflare(timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const url = this.page.url();
      const title = await this.page.title().catch(() => "");
      const isCF =
        title.includes("Just a moment") ||
        title.includes("Checking your browser") ||
        url.includes("challenge") ||
        url.includes("cdn-cgi");
      if (!isCF) return;
      this.log("Waiting for Cloudflare challenge to resolve...");
      await this._sleep(2000);
    }
  }

  async _fillLogin() {
    this.log("Waiting for login form fields...");

    // Email field: type="text" placeholder="Username" (Element UI / Vue SPA)
    await this.page.waitForSelector('input.el-input__inner[placeholder="Username"]', { timeout: 15000 });

    const emailField = await this.page.$('input.el-input__inner[placeholder="Username"]');
    if (!emailField) throw new Error("Could not find Username input field");

    await emailField.click({ clickCount: 3 });
    await this.page.keyboard.type(this.email, { delay: 50 });
    this.log("Email/username entered.");

    // Password field: type="password" placeholder="Password" (Element UI)
    const passField = await this.page.$('input.el-input__inner[placeholder="Password"]');
    if (!passField) throw new Error("Could not find Password input field");

    await passField.click({ clickCount: 3 });
    await this.page.keyboard.type(this.password, { delay: 50 });
    this.log("Password entered. Looking for submit button...");

    // Find the login submit button — Vue SPA so we click the button, not press Enter
    const submitBtn = await this.page.$(
      'button[type="submit"], button.el-button--primary, button[class*="login" i], button[class*="submit" i]'
    ).catch(() => null);

    const loginUrl = this.page.url();

    if (submitBtn) {
      this.log("Clicking submit button...");
      await submitBtn.click();
    } else {
      this.log("No submit button found, pressing Enter...");
      await passField.press("Enter");
    }

    // SPA: don't use waitForNavigation — wait for URL to change or error to appear
    this.log("Waiting for login response...");
    await this._waitForLoginResult(loginUrl, 20000);

    const url = this.page.url();
    this.log(`Login successful. URL: ${url}`);
  }

  async _waitForLoginResult(loginUrl, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await this._sleep(800);

      const url = this.page.url();

      // Success: URL changed away from login
      if (url !== loginUrl && !url.includes("/auth/login") && !url.includes("/login")) {
        return;
      }

      // Failure: error message visible on page
      const errEl = await this.page.$(
        '.el-message--error, .el-notification--error, [class*="error-msg"], [class*="login-error"], .el-alert--error'
      ).catch(() => null);
      if (errEl) {
        const errText = await errEl.evaluate((el) => el.textContent.trim()).catch(() => "Login error");
        throw new Error(`Login failed: ${errText}`);
      }
    }
    throw new Error("Login timed out — credentials may be incorrect or site is slow");
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
        await this._waitForCloudflare(15000);
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
      await this._waitForCloudflare(15000);
      this.reloadCount++;
      this.log("Manual reload triggered.");
      this.onStatusChange(this.getState());
      return true;
    } catch (err) {
      this.log(`Manual reload failed: ${err.message}`, "warn");
      return false;
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = AFKBot;

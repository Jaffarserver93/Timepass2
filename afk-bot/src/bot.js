const { connect } = require("puppeteer-real-browser");
const { fetchOTP } = require("./imap");


const LOGIN_URL = "https://www.bytenut.com/auth/login";
const TARGET_URL = "https://www.bytenut.com/free-gamepanel/87079436";
const RELOAD_INTERVAL_MS = 60 * 1000;
const SCREENSHOT_INTERVAL_MS = 500;

class AFKBot {
  constructor({ email, password, imapConfig, onScreenshot, onLog, onStatusChange }) {
    this.email = email;
    this.password = password;
    this.imapConfig = imapConfig || null;

    this.onScreenshot = onScreenshot || (() => {});
    this.onLog = onLog || (() => {});
    this.onStatusChange = onStatusChange || (() => {});

    this.browser = null;
    this.page = null;
    this.running = false;
    this.renewing = false;   // mutex: true while OTP renewal is in progress
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
      this.log("AFK target page loaded. Checking server status...");

      // Non-fatal: renewal failure should NOT kill the bot
      await this._checkAndRenewIfPaused().catch((e) =>
        this.log(`Auto-renew failed (bot will continue): ${e.message}`, "warn")
      );

      this.startTime = Date.now();
      this.reloadCount = 0;
      this.setStatus("running");
      this.log("Bot is now active!");

      this._startScreenshotLoop();
      this._startReloadLoop();
    } catch (err) {
      this.lastError = err.message;
      this.log(`Bot error: ${err.message}`, "error");
      this.setStatus("error");
      await this.stop();
    }
  }

  // ── Cloudflare ─────────────────────────────────────────────────────────────

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

  // ── Login ──────────────────────────────────────────────────────────────────

  async _fillLogin() {
    this.log("Waiting for login form fields...");

    await this.page.waitForSelector('input.el-input__inner[placeholder="Username"]', { timeout: 15000 });

    const emailField = await this.page.$('input.el-input__inner[placeholder="Username"]');
    if (!emailField) throw new Error("Could not find Username input field");
    await emailField.click({ clickCount: 3 });
    await this.page.keyboard.type(this.email, { delay: 50 });
    this.log("Email/username entered.");

    const passField = await this.page.$('input.el-input__inner[placeholder="Password"]');
    if (!passField) throw new Error("Could not find Password input field");
    await passField.click({ clickCount: 3 });
    await this.page.keyboard.type(this.password, { delay: 50 });
    this.log("Password entered. Looking for submit button...");

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
      if (url !== loginUrl && !url.includes("/auth/login") && !url.includes("/login")) return;

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

  // ── Server Paused / Auto-Renew ─────────────────────────────────────────────

  async _checkAndRenewIfPaused() {
    // Guard: only one renewal at a time
    if (this.renewing) {
      this.log("Renewal already in progress — skipping duplicate check.", "info");
      return;
    }

    await this._sleep(2000); // let SPA render
    const banner = await this.page.$(".expired-warning-banner").catch(() => null);
    if (!banner) {
      this.log("Server is running normally. No renewal needed.");
      return;
    }

    this.renewing = true;
    this.log("⚠ Server Paused banner detected! Starting auto-renewal...", "warn");
    this.setStatus("renewing");

    try {
      // Step 1: wait for Turnstile to be solved BEFORE clicking Send Code.
      // The renewal modal embeds a Turnstile widget; clicking too early sends
      // no verification request and no OTP email is triggered.
      this.log("Waiting for Turnstile challenge to be solved...");
      await this._waitForTurnstile(60000);
      this.log("Turnstile solved. Clicking 'Send Code' button...");

      // Record timestamp right before clicking — IMAP will only accept emails
      // received after this moment (prevents stale OTP reuse)
      const sendCodeTime = Date.now();
      await this._clickButtonByText("Send Code");
      this.log("Send Code clicked. Waiting 5 seconds for OTP email to arrive...");
      await this._sleep(5000); // give the mail server time to deliver before IMAP search

      // Step 2: fetch OTP from email
      if (!this.imapConfig || !this.imapConfig.host) {
        throw new Error("IMAP credentials not set in .env — cannot fetch OTP. Set IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS.");
      }

      const otp = await fetchOTP({
        ...this.imapConfig,
        sender: "noreply@bytenut.com",
        timeout: 120000,
        sentAfter: sendCodeTime,  // only accept emails received AFTER clicking Send Code
      });
      this.log(`OTP received: ${otp}`);

      // Step 3: type OTP into code field
      await this._sleep(1000);
      const codeField = await this.page.$('input.el-input__inner[placeholder="6-digit code"]');
      if (!codeField) throw new Error("Could not find 6-digit code input field");
      await codeField.click({ clickCount: 3 });
      await codeField.evaluate((el) => { el.value = ""; }); // clear any pre-filled value
      await this.page.keyboard.type(otp, { delay: 80 });
      this.log("OTP entered into code field.");

      // Step 4: click Extend button
      await this._sleep(500);
      this.log("Clicking 'Extend' button...");
      await this._clickButtonByText("Extend");
      this.log("Extend clicked! Waiting for renewal confirmation...");

      // Step 4b: check for OTP error (wrong code) before waiting for success
      await this._sleep(1500);
      const otpError = await this._getOTPErrorText();
      if (otpError) {
        throw new Error(`OTP rejected by server: "${otpError}". The code may have expired or was incorrect.`);
      }

      // Step 5: wait for banner to disappear or success indicator
      await this._waitForRenewalSuccess();
      this.log("✅ Server renewed successfully!", "info");

    } catch (err) {
      this.log(`Renewal failed: ${err.message}`, "error");
      throw err;
    } finally {
      // Always release the mutex so future renewal attempts can proceed
      this.renewing = false;
    }
  }

  async _clickButtonByText(text) {
    // Try multiple strategies to find and click a button by its visible text
    const found = await this.page.evaluate((btnText) => {
      const all = [...document.querySelectorAll("button, span.el-button, a")];
      const el = all.find((e) => e.textContent.trim().includes(btnText));
      if (el) { el.click(); return true; }
      return false;
    }, text);

    if (found) return;

    // Fallback: XPath
    try {
      const [xBtn] = await this.page.$x(`//button[contains(., '${text}')] | //span[contains(@class,'el-button')][contains(., '${text}')]`);
      if (xBtn) { await xBtn.click(); return; }
    } catch (_) {}

    throw new Error(`Could not find button with text: "${text}"`);
  }

  async _waitForTurnstile(timeout = 60000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const solved = await this.page.evaluate(() => {
        // Strategy 1: cf-turnstile-response hidden input has a token value
        const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
        for (const inp of inputs) {
          if (inp.value && inp.value.length > 10) return true;
        }
        // Strategy 2: Turnstile iframe shows a success checkbox state
        const iframes = document.querySelectorAll('iframe[src*="challenges.cloudflare.com/turnstile"]');
        if (iframes.length === 0) {
          // No Turnstile widget present on this page — skip wait
          return true;
        }
        // Strategy 3: check for a success indicator in the widget wrapper
        const wrapper = document.querySelector('.cf-turnstile, [data-cf-turnstile]');
        if (wrapper) {
          const successEl = wrapper.querySelector('[data-state="solved"], .cf-success');
          if (successEl) return true;
        }
        return false;
      }).catch(() => true); // if page crashed or eval failed, proceed

      if (solved) return;
      await this._sleep(1000);
    }
    // Non-fatal: if we can't confirm, proceed anyway (library may have already solved it)
    this.log("Turnstile wait timed out — proceeding anyway.", "warn");
  }

  async _getOTPErrorText() {
    try {
      const errEl = await this.page.$(
        '.el-message--error, .el-notification--error, .el-form-item__error, [class*="error"][class*="msg"], .el-alert--error'
      );
      if (!errEl) return null;
      const text = await errEl.evaluate((el) => el.textContent.trim()).catch(() => "");
      return text || null;
    } catch (_) {
      return null;
    }
  }

  async _waitForRenewalSuccess(timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await this._sleep(1500);
      // Banner gone = success
      const banner = await this.page.$(".expired-warning-banner").catch(() => null);
      if (!banner) return;
      // Success indicator on page
      const success = await this.page.$(".el-icon-circle-check, [class*='success']").catch(() => null);
      if (success) return;
    }
    // Non-fatal — continue even if we can't confirm
    this.log("Could not confirm renewal success, continuing anyway...", "warn");
  }

  // ── Scroll ─────────────────────────────────────────────────────────────────

  async scroll(direction, amount = 300) {
    if (!this.page || !this.running) return false;
    try {
      const px = direction === "up" ? -amount : amount;
      await this.page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), px);
      return true;
    } catch (err) {
      this.log(`Scroll failed: ${err.message}`, "warn");
      return false;
    }
  }

  // ── Screenshot & Reload loops ──────────────────────────────────────────────

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

      // Skip reload entirely while renewal is in progress — reloading the page
      // would interrupt OTP entry and cause the renewal to fail
      if (this.renewing) {
        this.log("Renewal in progress — skipping scheduled page reload.", "info");
        return;
      }

      try {
        this.log("Reloading AFK target page...");
        await this.page.reload({ waitUntil: "networkidle2", timeout: 20000 });
        await this._waitForCloudflare(15000);

        // Check for paused banner after reload — mutex inside will guard duplicates
        await this._checkAndRenewIfPaused().catch((e) =>
          this.log(`Auto-renew after reload failed: ${e.message}`, "warn")
        );

        this.reloadCount++;
        this.log(`Page reloaded. Total reloads: ${this.reloadCount}`);
        this.onStatusChange(this.getState());
      } catch (err) {
        this.log(`Reload failed: ${err.message}`, "warn");
      }
    }, RELOAD_INTERVAL_MS);
  }

  // ── Stop / Reload ──────────────────────────────────────────────────────────

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
    if (this.renewing) {
      this.log("Renewal in progress — manual reload blocked to avoid interrupting OTP flow.", "warn");
      return false;
    }
    try {
      await this.page.reload({ waitUntil: "networkidle2", timeout: 20000 });
      await this._waitForCloudflare(15000);
      await this._checkAndRenewIfPaused().catch(() => {});
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

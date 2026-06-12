---
name: AFK Bot login selectors
description: bytenut.com login quirks — Element UI Vue SPA, correct field selectors, SPA nav detection
---

bytenut.com uses **Element UI** (Vue component library). All inputs have `class="el-input__inner"`.

**Correct selectors:**
- Email field: `input.el-input__inner[placeholder="Username"]` — type is `text`, NOT `email`
- Password field: `input.el-input__inner[placeholder="Password"]`
- Submit button: `button.el-button--primary` (also try `button[type="submit"]`)

**SPA navigation:** The site is a Vue SPA — form submit does NOT trigger a browser navigation event. `waitForNavigation` will time out. Instead, poll `page.url()` every 800ms until it changes away from `/auth/login`. Also watch for `.el-message--error` / `.el-alert--error` elements to detect wrong-password errors.

**How to apply:** Any time login fields or post-login detection needs updating, use these selectors and the polling approach in `_waitForLoginResult()`.

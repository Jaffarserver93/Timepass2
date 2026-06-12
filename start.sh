#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         AFK Bot — bytenut.com            ║${NC}"
echo -e "${CYAN}║   Cloudflare bypass via real browser     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_DIR="$ROOT_DIR/afk-bot"

if [ ! -d "$BOT_DIR" ]; then
  echo -e "${RED}✗ afk-bot/ directory not found at $BOT_DIR${NC}"
  exit 1
fi

cd "$BOT_DIR"

# ── Check Node.js ──────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js not found. Install Node.js 18+ from https://nodejs.org${NC}"
  exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.version)")
echo -e "${GREEN}✓ Node.js ${NODE_VER}${NC}"

# ── Install xvfb on Linux (needed for headless real browser) ──
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  if ! command -v Xvfb &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Installing Xvfb (virtual display for Cloudflare bypass)...${NC}"
    if command -v apt-get &> /dev/null; then
      sudo apt-get update -qq && sudo apt-get install -y -qq xvfb
    elif command -v yum &> /dev/null; then
      sudo yum install -y xorg-x11-server-Xvfb
    elif command -v pacman &> /dev/null; then
      sudo pacman -S --noconfirm xorg-server-xvfb
    else
      echo -e "${YELLOW}⚠  Could not install Xvfb automatically. Install it manually for best Cloudflare bypass.${NC}"
    fi
    echo -e "${GREEN}✓ Xvfb installed${NC}"
  else
    echo -e "${GREEN}✓ Xvfb present${NC}"
  fi
fi

# ── Install Chrome dependencies on Linux ──────────────────
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  if command -v apt-get &> /dev/null; then
    echo -e "${YELLOW}Installing Chrome system dependencies...${NC}"
    sudo apt-get install -y -qq \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
      libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
      libxfixes3 libxrandr2 libgbm1 libasound2 2>/dev/null || true
    echo -e "${GREEN}✓ Chrome dependencies ready${NC}"
  fi
fi

# ── Check .env ─────────────────────────────────────────────
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo ""
    echo -e "${YELLOW}⚠  Created afk-bot/.env from .env.example — fill in your credentials:${NC}"
    echo "    EMAIL=your@email.com"
    echo "    PASSWORD=yourpassword"
    echo "    PORT=3000"
    echo ""
    echo -e "${YELLOW}Then run ./start.sh again.${NC}"
    exit 1
  else
    echo -e "${RED}✗ afk-bot/.env file not found.${NC}"
    exit 1
  fi
fi

EMAIL_VAL=$(grep -E "^EMAIL=" .env | cut -d= -f2-)
PASS_VAL=$(grep -E "^PASSWORD=" .env | cut -d= -f2-)
PORT_VAL=$(grep -E "^PORT=" .env | cut -d= -f2-)
PORT_VAL="${PORT_VAL:-3000}"

if [ -z "$EMAIL_VAL" ] || [ "$EMAIL_VAL" = "your@email.com" ]; then
  echo -e "${RED}✗ EMAIL is not set in afk-bot/.env${NC}"; exit 1
fi
if [ -z "$PASS_VAL" ] || [ "$PASS_VAL" = "yourpassword" ]; then
  echo -e "${RED}✗ PASSWORD is not set in afk-bot/.env${NC}"; exit 1
fi
echo -e "${GREEN}✓ .env loaded (email: ${EMAIL_VAL})${NC}"

# ── Install npm packages ───────────────────────────────────
if [ ! -d "node_modules" ] || [ ! -d "node_modules/puppeteer-real-browser" ]; then
  echo ""
  echo -e "${YELLOW}Installing npm packages (first run may take a few minutes)...${NC}"
  npm install
  echo -e "${GREEN}✓ Packages installed${NC}"
else
  echo -e "${GREEN}✓ node_modules present${NC}"
fi

# ── Install Chrome for puppeteer-real-browser ─────────────
CHROME_INSTALLED=$(node -e "
try {
  const { executablePath } = require('puppeteer-real-browser/node_modules/puppeteer-core');
  process.stdout.write(executablePath() ? 'yes' : 'no');
} catch(e) {
  try {
    const pup = require('puppeteer');
    process.stdout.write(pup.executablePath() ? 'yes' : 'no');
  } catch(e2) { process.stdout.write('no'); }
}" 2>/dev/null || echo "no")

if [ "$CHROME_INSTALLED" = "no" ]; then
  echo ""
  echo -e "${YELLOW}Downloading Chromium browser...${NC}"
  node -e "
    const { execSync } = require('child_process');
    try {
      execSync('node node_modules/puppeteer-real-browser/node_modules/puppeteer/install.mjs', { stdio: 'inherit' });
    } catch(e) {
      try {
        execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
      } catch(e2) {
        console.log('Browser install skipped — will use system Chrome if available');
      }
    }
  " 2>/dev/null || true
  echo -e "${GREEN}✓ Chromium ready${NC}"
fi

# ── Start ──────────────────────────────────────────────────
echo ""
echo -e "${CYAN}┌─────────────────────────────────────────────┐${NC}"
echo -e "${CYAN}│  Starting AFK bot...                        │${NC}"
echo -e "${CYAN}│  Dashboard → http://localhost:${PORT_VAL}          │${NC}"
echo -e "${CYAN}│  Target    → gamepanel/87079436             │${NC}"
echo -e "${CYAN}│  Reload    → every 60 seconds               │${NC}"
echo -e "${CYAN}│  Cloudflare bypass: enabled (real browser)  │${NC}"
echo -e "${CYAN}└─────────────────────────────────────────────┘${NC}"
echo ""

node src/server.js

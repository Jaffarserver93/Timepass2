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
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Check Node.js ──────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js not found. Please install Node.js 18+ from https://nodejs.org${NC}"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.version)")
echo -e "${GREEN}✓ Node.js ${NODE_VER}${NC}"

# ── Check .env ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "${YELLOW}⚠  Created .env from .env.example — please fill in your EMAIL and PASSWORD${NC}"
    echo ""
    echo "  Edit .env and set:"
    echo "    EMAIL=your@email.com"
    echo "    PASSWORD=yourpassword"
    echo "    PORT=3000  (optional)"
    echo ""
    echo -e "${YELLOW}Then run ./start.sh again.${NC}"
    exit 1
  else
    echo -e "${RED}✗ .env file not found. Create one with EMAIL, PASSWORD, and PORT.${NC}"
    exit 1
  fi
fi

# ── Check credentials are set ──────────────────────────────
EMAIL_VAL=$(grep -E "^EMAIL=" .env | cut -d= -f2-)
PASS_VAL=$(grep -E "^PASSWORD=" .env | cut -d= -f2-)

if [ -z "$EMAIL_VAL" ] || [ "$EMAIL_VAL" = "your@email.com" ]; then
  echo -e "${RED}✗ EMAIL is not set in .env${NC}"
  exit 1
fi

if [ -z "$PASS_VAL" ] || [ "$PASS_VAL" = "yourpassword" ]; then
  echo -e "${RED}✗ PASSWORD is not set in .env${NC}"
  exit 1
fi

echo -e "${GREEN}✓ .env loaded (email: ${EMAIL_VAL})${NC}"

# ── Install dependencies ───────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo ""
  echo -e "${YELLOW}Installing npm packages...${NC}"
  npm install
  echo -e "${GREEN}✓ Packages installed${NC}"
else
  echo -e "${GREEN}✓ node_modules present${NC}"
fi

# ── Install Puppeteer browser ──────────────────────────────
CHROME_PATH=$(node -e "
try {
  const pup = require('puppeteer');
  const exec = pup.executablePath ? pup.executablePath() : '';
  process.stdout.write(exec);
} catch(e) { process.stdout.write(''); }
" 2>/dev/null || true)

if [ -z "$CHROME_PATH" ] || [ ! -f "$CHROME_PATH" ]; then
  echo ""
  echo -e "${YELLOW}Downloading Chromium browser for Puppeteer...${NC}"
  node node_modules/puppeteer/install.mjs || npx puppeteer browsers install chrome
  echo -e "${GREEN}✓ Chromium installed${NC}"
else
  echo -e "${GREEN}✓ Chromium ready${NC}"
fi

# ── Start ──────────────────────────────────────────────────
PORT_VAL=$(grep -E "^PORT=" .env | cut -d= -f2-)
PORT_VAL="${PORT_VAL:-3000}"

echo ""
echo -e "${CYAN}Starting AFK bot...${NC}"
echo -e "${CYAN}Dashboard → http://localhost:${PORT_VAL}${NC}"
echo ""

node src/server.js

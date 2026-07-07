#!/usr/bin/env bash
# Run the bot AND expose the dashboard on a STABLE, free public URL via
# Tailscale Funnel — no domain, no VPS. The URL (https://<machine>.<tailnet>.ts.net)
# stays the same every run, so you share it with yourself + the VTuber once.
# Ctrl+C stops everything.
#
#   chmod +x scripts/start-tailscale.sh   (once)
#   ./scripts/start-tailscale.sh
#
# One-time setup (see docs/TAILSCALE.md): install Tailscale, sign in, and enable
# Funnel for this machine in the Tailscale admin console.
set -euo pipefail
cd "$(dirname "$0")/.."

# Find the tailscale CLI (PATH, or the macOS app bundle).
if command -v tailscale >/dev/null 2>&1; then TS=tailscale
elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
else echo "❌ ยังไม่มี Tailscale — ติดตั้งจาก https://tailscale.com/download (หรือ brew install --cask tailscale) แล้วล็อกอิน"; exit 1; fi

[ -f .env ] || { echo "❌ ไม่พบไฟล์ .env"; exit 1; }
envval() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '[:space:]'; }
PORT=$(envval ADMIN_PORT); PORT=${PORT:-8787}
TOKEN=$(envval ADMIN_TOKEN)
if [ -z "$TOKEN" ]; then
  echo "❌ ยังไม่ได้ตั้ง ADMIN_TOKEN ใน .env — สร้าง:  openssl rand -hex 24"
  exit 1
fi

# Must be logged in.
if ! "$TS" status >/dev/null 2>&1; then
  echo "❌ ยังไม่ได้ล็อกอิน Tailscale — เปิดแอป Tailscale แล้ว Log in ก่อน (หรือ '$TS up')"
  exit 1
fi

echo "▶ เปิดบอท (พอร์ต dashboard $PORT)…"
node src/index.js &
BOT=$!
trap 'echo; echo "⏹  ปิดบอท + funnel"; "$TS" funnel --https=443 off >/dev/null 2>&1 || true; kill "$BOT" 2>/dev/null || true' EXIT INT TERM
sleep 2

echo "▶ เปิด Tailscale Funnel (URL ถาวร)…"
# Foreground funnel; capture the public ts.net URL it prints.
"$TS" funnel "$PORT" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ https://[a-z0-9.-]+\.ts\.net ]]; then
    URL="${BASH_REMATCH[0]%/}"
    echo ""
    echo "==================================================================="
    echo "  ✅ Dashboard (URL ถาวร) — ส่งให้ตัวเอง + วีทูปเบอร์ครั้งเดียวพอ:"
    echo ""
    echo "     ${URL}/?token=${TOKEN}"
    echo ""
    echo "  (เปิดครั้งแรกด้วยลิงก์นี้ แล้ว token ถูกจำใน cookie อัตโนมัติ)"
    echo "==================================================================="
  fi
done

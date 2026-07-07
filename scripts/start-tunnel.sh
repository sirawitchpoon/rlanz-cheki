#!/usr/bin/env bash
# Run the bot AND a Cloudflare Quick Tunnel together, then print a shareable
# dashboard link. For the Mac Mini "start it only during a drop" workflow —
# no VPS, no domain. Stop everything with Ctrl+C.
#
#   chmod +x scripts/start-tunnel.sh   (once)
#   ./scripts/start-tunnel.sh
#
# Needs: cloudflared  (brew install cloudflared)
set -euo pipefail
cd "$(dirname "$0")/.."

command -v cloudflared >/dev/null 2>&1 || { echo "❌ ยังไม่มี cloudflared — ติดตั้งก่อน:  brew install cloudflared"; exit 1; }
[ -f .env ] || { echo "❌ ไม่พบไฟล์ .env"; exit 1; }

# Pull ADMIN_PORT / ADMIN_TOKEN out of .env
PORT=$(grep -E '^ADMIN_PORT=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]')
TOKEN=$(grep -E '^ADMIN_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]')
PORT=${PORT:-8787}
if [ -z "$TOKEN" ]; then
  echo "❌ ยังไม่ได้ตั้ง ADMIN_TOKEN ใน .env (ต้องมีไว้ล็อกอินผ่าน tunnel)"
  echo "   สร้าง token แข็งแรง:  openssl rand -hex 24"
  exit 1
fi

echo "▶ เปิดบอท (พอร์ต dashboard $PORT)…"
node src/index.js &
BOT=$!
# Kill the bot when this script exits (Ctrl+C included)
trap 'echo; echo "⏹  ปิดบอท + tunnel"; kill "$BOT" 2>/dev/null || true' EXIT INT TERM

# Give the bot a moment to bind the port
sleep 2

echo "▶ เปิด Cloudflare Quick Tunnel…"
cloudflared tunnel --url "http://localhost:${PORT}" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ https://[a-z0-9-]+\.trycloudflare\.com ]]; then
    URL="${BASH_REMATCH[0]}"
    echo ""
    echo "==================================================================="
    echo "  ✅ Dashboard พร้อมแล้ว — ส่งลิงก์นี้ให้ตัวเอง + วีทูปเบอร์:"
    echo ""
    echo "     ${URL}/?token=${TOKEN}"
    echo ""
    echo "  (เปิดครั้งแรกด้วยลิงก์นี้ แล้ว token จะถูกจำไว้ใน cookie อัตโนมัติ)"
    echo "==================================================================="
  fi
done

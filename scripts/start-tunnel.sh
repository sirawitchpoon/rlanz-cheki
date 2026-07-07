#!/usr/bin/env bash
# Run the bot AND a Cloudflare tunnel together, then print a dashboard link.
# For the Mac Mini "start it only during a drop" workflow — no VPS. Ctrl+C stops
# everything.
#
#   chmod +x scripts/start-tunnel.sh   (once)
#   ./scripts/start-tunnel.sh
#
# Two tunnel modes, chosen automatically from .env:
#   * Named tunnel (STABLE URL)  — set CF_TUNNEL_TOKEN (needs a domain on
#     Cloudflare; create the tunnel + hostname in the Zero Trust dashboard).
#     Optionally set CF_TUNNEL_HOSTNAME so the script can print the full link.
#   * Quick tunnel (random URL)  — no CF_TUNNEL_TOKEN; free, no domain, but the
#     URL changes every run.
#
# Needs: cloudflared  (brew install cloudflared)
set -euo pipefail
cd "$(dirname "$0")/.."

command -v cloudflared >/dev/null 2>&1 || { echo "❌ ยังไม่มี cloudflared — ติดตั้งก่อน:  brew install cloudflared"; exit 1; }
[ -f .env ] || { echo "❌ ไม่พบไฟล์ .env"; exit 1; }

envval() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '[:space:]'; }
PORT=$(envval ADMIN_PORT); PORT=${PORT:-8787}
TOKEN=$(envval ADMIN_TOKEN)
CF_TUNNEL_TOKEN=$(envval CF_TUNNEL_TOKEN)
CF_TUNNEL_HOSTNAME=$(envval CF_TUNNEL_HOSTNAME)

if [ -z "$TOKEN" ]; then
  echo "❌ ยังไม่ได้ตั้ง ADMIN_TOKEN ใน .env (ต้องมีไว้ล็อกอินผ่าน tunnel)"
  echo "   สร้าง token แข็งแรง:  openssl rand -hex 24"
  exit 1
fi

echo "▶ เปิดบอท (พอร์ต dashboard $PORT)…"
node src/index.js &
BOT=$!
trap 'echo; echo "⏹  ปิดบอท + tunnel"; kill "$BOT" 2>/dev/null || true' EXIT INT TERM
sleep 2

if [ -n "$CF_TUNNEL_TOKEN" ]; then
  # ---- Named tunnel: STABLE URL (hostname configured in Cloudflare) ----
  echo "▶ เปิด Named Tunnel (URL ถาวร)…"
  echo "==================================================================="
  if [ -n "$CF_TUNNEL_HOSTNAME" ]; then
    echo "  ✅ Dashboard:  https://${CF_TUNNEL_HOSTNAME}/?token=${TOKEN}"
  else
    echo "  ✅ Dashboard:  ใช้ URL ถาวรที่ตั้งไว้ใน Cloudflare  (ต่อท้าย /?token=${TOKEN})"
  fi
  echo "  (URL เดิมทุกครั้ง — ส่งให้ตัวเอง + วีทูปเบอร์ครั้งเดียวพอ)"
  echo "==================================================================="
  cloudflared tunnel run --token "$CF_TUNNEL_TOKEN"
else
  # ---- Quick tunnel: random URL each run (no domain needed) ----
  echo "▶ เปิด Cloudflare Quick Tunnel (URL ชั่วคราว)…"
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
      echo "  (URL เปลี่ยนทุกครั้ง — อยากได้ถาวร ตั้ง CF_TUNNEL_TOKEN ใน .env)"
      echo "==================================================================="
    fi
  done
fi

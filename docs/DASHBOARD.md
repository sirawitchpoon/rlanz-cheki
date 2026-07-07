# Web Dashboard + Cloudflare (auth "เฉพาะฉัน")

Dashboard หลังบ้านสำหรับดูสถานะ + สั่งเปิด/ปิด/ข้ามคิว โดย **ไม่ต้องเปิดพอร์ตออกเน็ต** และ auth ให้เฉพาะอีเมลคุณเข้าได้

## ภาพรวมสถาปัตยกรรม

```
เบราว์เซอร์คุณ
   │  https://cheki-admin.yourdomain.com
   ▼
[Cloudflare Access]  ← ด่าน auth: อนุญาตเฉพาะอีเมลคุณ (ฟรี ≤50 คน)
   │  (ผ่านแล้ว Cloudflare แนบ header Cf-Access-Authenticated-User-Email)
   ▼
[Cloudflare Tunnel / cloudflared]  ← ไม่ต้องมี public IP / ไม่เปิดพอร์ต firewall
   │
   ▼
[Admin server ในบอท  127.0.0.1:8787]  ← อ่าน SQLite + สั่งงานผ่าน service เดิม (มี mutex)
```

**ทำไมต้องเป็นแบบนี้:** Cloudflare Pages/Workers รันบอทเองไม่ได้ (บอทต้องเปิด gateway ค้าง) และอ่าน SQLite บน VPS ตรงๆ ไม่ได้ → เราจึงรัน admin server ฝังในบอท แล้วให้ Cloudflare เป็นแค่ประตู (auth + TLS + ซ่อน IP) ซึ่ง **ฟรีทั้งหมด**

---

## 1. เปิด dashboard ในบอท

เพิ่มใน `.env` (ดู `.env.example`):
```
ADMIN_PORT=8787
ADMIN_HOST=127.0.0.1
ADMIN_ALLOWED_EMAILS=you@gmail.com
```
ลง dependency ใหม่ (`express`) แล้วรีสตาร์ท:
```bash
# Docker
docker compose up -d --build
# หรือ PM2
npm install && pm2 restart cheki
```
ควรเห็น log: `Admin dashboard listening on http://127.0.0.1:8787`

> ทดสอบในเครื่องก่อน (ยังไม่ต้อง Cloudflare): ตั้ง `ADMIN_TOKEN=secret123` แล้วเปิด
> `curl -H "X-Admin-Token: secret123" http://127.0.0.1:8787/api/status`

---

## 2. ตั้ง Cloudflare Tunnel

ต้องมี **โดเมนใน Cloudflare** (โดเมนถูกๆ ปีละไม่กี่ร้อยบาท แล้วชี้ nameserver มา Cloudflare)

**วิธีง่าย (Dashboard-managed tunnel):**
1. ไป https://one.dash.cloudflare.com → **Networks → Tunnels → Create a tunnel** → ตั้งชื่อ เช่น `cheki`
2. เลือก connector = **Cloudflared** แล้วก็อปคำสั่งติดตั้งที่มันให้มา (มี token) ไปรันบน VPS
3. ตั้ง **Public hostname**:
   - Subdomain: `cheki-admin` / Domain: `yourdomain.com`
   - Service: `HTTP` → `localhost:8787`

**บน VPS (บอทรันด้วย PM2/bare):** รันคำสั่งติดตั้งที่ Cloudflare ให้มา — จบ

**บน VPS (บอทรันใน Docker):** ให้ cloudflared คุยกับ container ผ่าน network เดียวกัน — เพิ่ม service นี้ต่อท้าย `docker-compose.yml` แล้วเปลี่ยน `ADMIN_HOST=0.0.0.0` (พอร์ตยัง **ไม่** publish ออก host จึงไม่โผล่เน็ต):
```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cheki-tunnel
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CF_TUNNEL_TOKEN}
    depends_on: [bot]
```
แล้วใน Cloudflare ตั้ง Public hostname → Service = `http://bot:8787`
(ใส่ `CF_TUNNEL_TOKEN=...` ใน `.env`)

---

## 3. ตั้ง Cloudflare Access (auth เฉพาะคุณ)

1. https://one.dash.cloudflare.com → **Access → Applications → Add an application → Self-hosted**
2. Application domain = `cheki-admin.yourdomain.com`
3. **Add policy:**
   - Action: **Allow**
   - Rule: **Emails** → ใส่ `you@gmail.com` (เฉพาะอีเมลคุณ)
4. Identity provider: เปิด **One-time PIN** (ส่งรหัสเข้าอีเมล) หรือผูก Google login ก็ได้
5. เซฟ

เสร็จแล้วเข้า `https://cheki-admin.yourdomain.com` — จะเจอหน้า login ของ Cloudflare ก่อน ผ่านแล้วถึงเห็น dashboard

---

## 4. ความปลอดภัย (ชั้นที่ซ้อนกัน)

| ชั้น | ป้องกันอะไร |
|---|---|
| bind `127.0.0.1` (หรือไม่ publish port ใน Docker) | คนนอกยิงตรงเข้าพอร์ตไม่ได้ ต้องผ่าน Cloudflare เท่านั้น |
| Cloudflare Access | ต้องเป็นอีเมลใน policy เท่านั้นถึงผ่าน |
| `ADMIN_ALLOWED_EMAILS` ในโค้ด | ตรวจ `Cf-Access-Authenticated-User-Email` ซ้ำอีกชั้น (กัน misconfig) |

**อัปเกรดในอนาคต (ถ้าอยากแน่นขึ้น):** verify ลายเซ็น JWT `Cf-Access-Jwt-Assertion` กับ public key ของทีมคุณ แทนการเชื่อ header เฉยๆ — เพิ่มได้ภายหลังใน `src/admin/server.js` (ฟังก์ชัน auth gate)

---

## API ที่มีให้ (สำหรับต่อยอด)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/status` | ดรอปปัจจุบัน + ทุกลาย + **ลายไหนอยู่ห้องไหน** (channelId) |
| GET | `/api/drops/:id` | รายละเอียดดรอป + ออเดอร์ |
| POST | `/api/drops/:id/reveal` | เปิดขายเดี๋ยวนี้ (เหมือน timer publish) |
| POST | `/api/drops/:id/cancel` | ยกเลิกดรอป |
| POST | `/api/drops/:id/cleanup` | ลบห้องชำระเงินทั้งหมด (เก็บออเดอร์ไว้) |
| POST | `/api/items/:id/release` | ข้ามคิว #1 ของลายนั้น (advance) |

ทุก write action เรียกผ่าน service เดิม (`dropService`/`ticketService`/`queueService`) จึงยัง **ปลอดภัยเรื่อง concurrency** (mutex + transaction) เหมือนกดปุ่มใน Discord

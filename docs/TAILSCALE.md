# URL ถาวรฟรีด้วย Tailscale Funnel (ไม่ต้องมีโดเมน)

ให้ dashboard มี **URL สาธารณะถาวร** `https://<ชื่อเครื่อง>.<tailnet>.ts.net` โยงมาที่บอทบน Mac Mini — ฟรี ไม่ต้องซื้อโดเมน/VPS และ **คนอื่นเปิดดูได้โดยไม่ต้องลง Tailscale** (Funnel = public) กันด้วย `ADMIN_TOKEN` เหมือนเดิม

## ตั้งค่าครั้งเดียว

1. **ติดตั้ง Tailscale** บน Mac Mini — https://tailscale.com/download (แอป Mac) หรือ `brew install --cask tailscale`
2. **เปิดแอป → Log in** (Google/GitHub/อีเมล) — จะได้ "tailnet" ของคุณ
3. **เปิดใช้ Funnel** ให้เครื่องนี้:
   - ลองรัน `./scripts/start-tailscale.sh` ครั้งแรก
   - ถ้า Funnel ยังไม่เปิด Tailscale จะพิมพ์ **ลิงก์สำหรับเปิด** ออกมา (`https://login.tailscale.com/f/funnel?...`) → เปิดลิงก์นั้น กด **Approve/Enable** ในหน้า admin
   - (เบื้องหลังคือเปิด HTTPS certificates + node attribute `funnel` ให้ tailnet)
   - รันสคริปต์อีกครั้ง

> ต้องมี `ADMIN_TOKEN` ใน `.env` ก่อน (สร้าง: `openssl rand -hex 24`)

## ใช้งานทุกครั้งที่เปิดดรอป

```bash
./scripts/start-tailscale.sh
```
มันจะเปิดบอท + Funnel แล้วพิมพ์ **URL ถาวร** ออกมา เช่น:
```
https://cheki-macmini.tailxxxx.ts.net/?token=<ADMIN_TOKEN>
```
ส่งลิงก์นี้ให้ตัวเอง + วีทูปเบอร์ (ลิงก์**เดิมทุกครั้ง** ส่งครั้งเดียวพอ) → ขายจบกด **Ctrl+C**

## ข้อควรรู้

- URL เป็น **public** — ใครมีลิงก์ + token ครบเข้าได้ → **ตั้ง `ADMIN_TOKEN` ให้ยาว/สุ่ม** อย่าแชร์เกิน 2 คน (token ไม่ค้างใน URL เพราะเก็บเป็น cookie ให้หลังเปิดครั้งแรก)
- ตั้งชื่อเครื่องให้จำง่ายได้ใน admin console (Machines → rename) → URL จะสวยขึ้น
- อยากได้ **ล็อกอินด้วยอีเมล** (แทน token) แบบเป๊ะๆ ต้องใช้โดเมน + Cloudflare Access (ดู `docs/DASHBOARD.md`) — Tailscale Funnel เพียวๆ ใช้ token

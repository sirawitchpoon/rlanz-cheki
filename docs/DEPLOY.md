# คู่มือ Deploy บน VPS (rlanz-cheki)

คู่มือนี้พาตั้งแต่ **เช่า/สมัคร VPS → ลง Docker → รันบอท 24 ชม.** สำหรับคนที่ไม่เคยใช้ Linux มาก่อนก็ทำตามได้

> สรุปสั้น: บอทนี้เบามาก (~80–150MB RAM) ต้องการแค่เครื่องที่เปิดตลอด + เน็ต ไม่ต้องมี public IP/โดเมน
> (ถ้าจะต่อ Dashboard ผ่าน Cloudflare Tunnel ดู [DASHBOARD.md](./DASHBOARD.md))

---

## 0. เลือก VPS (ราคา ก.ค. 2026)

| เจ้า | ราคา | Region | เหมาะกับ |
|---|---|---|---|
| **Oracle Cloud Always Free** | ฿0 | สิงคโปร์/โตเกียว | ประหยัดสุด รับความยุ่งยากตอนสมัครได้ |
| **RackNerd** | ~$11–16/ปี (~35฿/เดือน) | US | จ่ายเงินนิดหน่อยแลกความชิลล์ (แนะนำ) |
| **Vultr** | ~$3.50/เดือน | สิงคโปร์ | อยาก Asia region + จ่าย PayPal ง่าย |

**สเปกขั้นต่ำ:** 1 vCPU / **1GB RAM** / 20GB disk / Ubuntu 24.04 LTS
(RAM ต้อง ≥1GB เพราะ `better-sqlite3` ต้องคอมไพล์ native module; 512MB ทำได้แต่ต้องเพิ่ม swap)

เลือกทางใดทางหนึ่งด้านล่าง (A หรือ B) แล้วข้ามไปข้อ 2 ได้เลย

---

## 1A. สมัคร Oracle Cloud Always Free (฿0)

1. สมัครที่ https://www.oracle.com/cloud/free/ — ต้องผูกบัตรเครดิต/เดบิต (ใช้ยืนยันตัวตน **ไม่มีการตัดเงิน** ใน Always Free)
2. เลือก Home Region เป็น **Singapore** หรือ **Tokyo** (ใกล้ไทย + มักมีของว่าง)
3. สร้าง Instance:
   - Menu → **Compute → Instances → Create Instance**
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **Ampere (ARM) VM.Standard.A1.Flex** → 1 OCPU / 6GB (อยู่ในโควตาฟรี)
     - ถ้าขึ้น "Out of capacity" → ลองเปลี่ยน Availability Domain หรือลองใหม่ช่วงกลางคืน
   - **บันทึก SSH key** ที่มันให้ดาวน์โหลด (ไฟล์ `.key`) ไว้ให้ดี
4. เปิดให้ SSH เข้าได้: ปกติ port 22 เปิดอยู่แล้ว ถ้าต่อไม่ได้ ไปที่ **VCN → Security List → Add Ingress Rule** เปิด TCP 22
5. จดค่า **Public IP** ของ instance

> ⚠️ Oracle มีนโยบาย "ปิด VM ที่ idle" — บอท Discord มี traffic ตลอดมักรอด แต่กันไว้ก่อนด้วย keep-alive (ดูข้อ 6)

**ต่อเข้าเครื่อง:**
```bash
chmod 400 ~/Downloads/your-key.key
ssh -i ~/Downloads/your-key.key ubuntu@<PUBLIC_IP>
```

---

## 1B. สมัคร RackNerd (~$11–16/ปี)

1. หาแพลนถูกใน https://racknerd.com (มองหา deal 1GB KVM VPS รายปี ช่วง Black Friday/New Year ถูกสุด)
2. ตอนสั่งซื้อเลือก **OS: Ubuntu 24.04 (64-bit)**
3. หลังจ่ายเงิน จะได้อีเมลมี **IP / root password** (บางทีต้องรอ provisioning สักครู่)

**ต่อเข้าเครื่อง:**
```bash
ssh root@<IP>
# ใส่ password ที่ได้จากอีเมล แล้วแนะนำให้เปลี่ยนทันที: passwd
```

---

## 2. เตรียมเครื่อง + ลง Docker

รันทีละบล็อกบนเครื่อง VPS (ถ้าล็อกอินเป็น `root` ตัด `sudo` ออกได้)

```bash
# อัปเดตระบบ
sudo apt update && sudo apt -y upgrade

# ลง Docker + Compose (สคริปต์ทางการ)
curl -fsSL https://get.docker.com | sudo sh

# (ถ้าไม่ได้เป็น root) ให้ user รัน docker ได้โดยไม่ต้อง sudo
sudo usermod -aG docker $USER
# ออกแล้ว ssh กลับเข้ามาใหม่ 1 ครั้งเพื่อให้ group มีผล
```

ถ้า RAM = 512MB ให้เพิ่ม swap 1GB กัน build ล้ม (ข้ามได้ถ้า RAM ≥1GB):
```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 3. เอาโค้ดขึ้นเครื่อง

```bash
sudo apt -y install git
git clone https://github.com/sirawitchpoon/rlanz-cheki.git
cd rlanz-cheki
```

---

## 4. ตั้งค่า `.env`

```bash
cp .env.example .env
nano .env      # แก้ไข แล้ว Ctrl+O บันทึก, Ctrl+X ออก
```

กรอก 3 ค่านี้ (จาก https://discord.com/developers/applications):

```
DISCORD_TOKEN=<Bot token>
APP_ID=<Application ID>
GUILD_ID=<ID เซิร์ฟเวอร์ Rlanz CAFÉ>
```

> เอา Guild ID: เปิด Discord → User Settings → Advanced → เปิด Developer Mode → คลิกขวาที่ไอคอนเซิร์ฟเวอร์ → Copy Server ID

**ตั้งค่า Bot ใน Developer Portal ให้ครบ (สำคัญ):**
- **Bot → Privileged Gateway Intents → เปิด `SERVER MEMBERS INTENT`** (บอทใช้ auto-advance คิวเมื่อคน #1 ออกจากเซิร์ฟเวอร์ — ถ้าไม่เปิด บอท login ไม่ได้)
- **สิทธิ์บอทในเซิร์ฟเวอร์:** Manage Channels, Manage Roles, Send Messages, Embed Links, Attach Files, Read Message History, Manage Messages

---

## 5. Build + รัน + ลงทะเบียนคำสั่ง

```bash
# 1) build image + รัน (restart อัตโนมัติเมื่อเครื่อง reboot)
docker compose up -d --build

# 2) ลงทะเบียนคำสั่ง /cheki เข้ากิลด์ (รันครั้งเดียว + ทุกครั้งที่แก้ command definition)
docker compose run --rm bot node src/deploy-commands.js

# 3) ดู log
docker compose logs -f
```

เห็น `Logged in as ... ✅` = สำเร็จ

**ในเซิร์ฟเวอร์ Discord ตั้งค่าครั้งแรก:**
```
/cheki config  announce_channel:#cheki-drop  ticket_category:CASHIER  admin_role:@ผู้ดูแลรง  promptpay_id:0xxxxxxxxx
/cheki init    (สร้างดรอป + วางแผงควบคุมในห้อง #admin)
```

---

## 6. ดูแลรักษา

```bash
# อัปเดตโค้ดใหม่ (สำคัญ: build ก่อน deploy-commands เสมอ)
git pull && docker compose up -d --build
docker compose run --rm bot node src/deploy-commands.js   # เฉพาะตอนแก้คำสั่ง

# ดูสถานะ / รีสตาร์ท / หยุด
docker compose ps
docker compose restart
docker compose down

# ส่องข้อมูลใน DB
docker compose exec bot node -e "console.table(require('better-sqlite3')('./data/cheki.db').prepare('SELECT * FROM won_orders').all())"

# แบ็กอัป DB + รูป (สำคัญมาก — นี่คือข้อมูลออเดอร์ทั้งหมด)
tar czf backup-$(date +%F).tgz data/
```

**Keep-alive สำหรับ Oracle** (กัน idle-reclaim) — ตั้ง cron ping เบาๆ:
```bash
( crontab -l 2>/dev/null; echo "*/10 * * * * docker compose -f ~/rlanz-cheki/docker-compose.yml exec -T bot node -e 'process.exit(0)' >/dev/null 2>&1" ) | crontab -
```

---

## 7. ทางเลือก: ไม่ใช้ Docker (PM2)

ถ้าอยากรันตรงๆ ไม่ผ่าน Docker:
```bash
sudo apt -y install nodejs npm
sudo npm i -g pm2
npm ci
npm run deploy                      # ลงทะเบียนคำสั่ง
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup             # ให้รอดหลัง reboot (ทำตามคำสั่งที่มันพิมพ์ออกมา)
pm2 logs cheki
```

---

## Troubleshooting

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| บอท login ไม่ได้ / `Used disallowed intents` | ยังไม่เปิด **Server Members Intent** ใน Developer Portal |
| `/cheki` ไม่ขึ้นในเซิร์ฟเวอร์ | ยังไม่รัน `deploy-commands` หรือ `GUILD_ID` ผิด |
| แก้โค้ดแล้วไม่มีผล | Docker ฝัง `src/` ไว้ใน image — ต้อง `docker compose up -d --build` **ก่อน** deploy-commands เสมอ |
| container ถูกฆ่า exit 137 | OOM — เพิ่ม `mem_limit` ใน docker-compose.yml หรือเพิ่ม swap |
| better-sqlite3 build ล้ม | RAM ไม่พอตอนคอมไพล์ — เพิ่ม swap (ดูข้อ 2) |

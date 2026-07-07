# สำรองออเดอร์ขึ้น Supabase (กันข้อมูลหาย)

โมเดล: **SQLite ยังเป็นตัวหลัก** (บอทเร็ว + ทำงานได้แม้เน็ตหลุดตอนดรอป) ส่วน Supabase เป็น **สำเนาสำรองบนคลาวด์** ที่อัปเดตอัตโนมัติทุกครั้งที่ปิดการขาย/ส่งเลขแทร็ก → ถ้า Mac/ไฟล์ `cheki.db` หาย ข้อมูลออเดอร์ (ผู้ซื้อ/ที่อยู่/เลขแทร็ก) ยังอยู่ครบใน Supabase และเปิดดูใน dashboard ของ Supabase ได้

> ปลอดภัย: การ sync เป็น best-effort (fire-and-forget) — ถ้า Supabase ล่ม/เน็ตหลุด **การขายไม่สะดุด** แค่ log ไว้แล้วไปต่อ

## 1. สร้าง Supabase project + ตาราง

1. สมัคร/ล็อกอิน https://supabase.com → **New project** (ฟรี tier พอ)
2. ไปที่ **SQL Editor** → รันคำสั่งนี้เพื่อสร้างตาราง:

```sql
create table if not exists cheki_orders (
  item_id          bigint primary key,   -- ใช้ upsert ตาม item_id
  drop_id          bigint,
  slot             int,
  title            text,
  buyer_user_id    text,
  price_satang     bigint,
  shipping_note    text,
  sold_at          bigint,
  tracking_no      text,
  tracking_carrier text,
  tracking_sent_at bigint,
  synced_at        timestamptz default now()
);

-- กันข้อมูลลูกค้า (ที่อยู่/ผู้ซื้อ) ไม่ให้อ่านได้จาก public/anon key.
-- เปิด RLS โดยไม่ใส่ policy = anon เข้าไม่ได้เลย, ส่วน service_role (ที่บอทใช้) bypass ได้ปกติ
alter table cheki_orders enable row level security;
```

## 2. เอา URL + Key มาใส่ `.env`

ใน Supabase → **Project Settings → API**:
- **Project URL** → `SUPABASE_URL`
- **service_role key** (secret!) → `SUPABASE_KEY`

```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_KEY=eyJ...   # service_role — เก็บเป็นความลับ อยู่แค่ใน .env (git ignore แล้ว)
SUPABASE_TABLE=cheki_orders
```

> ใช้ `service_role` เพราะบอทเขียนฝั่ง server (ข้าม RLS) — **ห้าม** เอา key นี้ไปไว้ฝั่งเว็บ/แชร์เด็ดขาด

## 3. รีสตาร์ทบอท + backfill ของเก่า

```bash
# รีสตาร์ทบอทให้โหลด .env ใหม่ (Ctrl+C แล้วรัน node src/index.js / start-tunnel.sh)
# ดันออเดอร์เดิมทั้งหมดขึ้น Supabase ครั้งเดียว:
node scripts/sync-supabase.js
```

จากนั้นทุกออเดอร์ใหม่ (ปิดการขาย + ส่งเลขแทร็ก) จะ sync ขึ้นเองอัตโนมัติ

## ตรวจว่าทำงาน

- Supabase → **Table Editor → cheki_orders** ควรเห็นแถวออเดอร์
- ลองส่งเลขแทร็ก → แถวนั้น `tracking_no` / `tracking_carrier` อัปเดต

## หมายเหตุ

- Sync ตาม **item_id** (upsert) → ยิงซ้ำได้ ไม่เกิดแถวซ้ำ
- ตอนนี้ sync เฉพาะ **ออเดอร์** (`won_orders`) ซึ่งเป็นข้อมูลสำคัญที่สุด — คิว/ลายเป็นข้อมูลชั่วคราว ไม่ต้องสำรอง
- อยากสำรอง **ทั้งไฟล์** ด้วย ก็ตั้ง cron อัปโหลด `data/cheki.db` ขึ้น Supabase Storage เพิ่มได้ (บอกได้ถ้าอยากให้ทำ)

# Schema v2 — รองรับหลายตัวละคร / หลายลาย / หลายดรอปพร้อมกัน

เอกสารออกแบบ (ยังไม่ implement) สำหรับตอนพร้อมสเกลจากระบบปัจจุบัน (1 ดรอป × 5 ลาย × 1 ตัวละคร) ไปเป็น **หลายตัวละคร แต่ละตัวมีหลายลาย และเปิดขายพร้อมกันได้**

> ⚠️ อย่าเพิ่ง migrate ระบบที่ขายจริงอยู่ตอนนี้ — v2 เป็นงานแก้โค้ด ทำบน branch แล้วเทสต์ให้ครบก่อน

---

## ข้อจำกัดของ v1 (ทำไมต้องเปลี่ยน)

| จุด | v1 ตอนนี้ | ปัญหาเมื่อสเกล |
|---|---|---|
| จำนวนลาย/ดรอป | hardcode 5 (`createDropWithItems` วน slot 1..5) | เพิ่ม/ลดลายไม่ได้ |
| ตัวละคร | ไม่มีคอนเซปต์ | แยกตัวละครไม่ได้ |
| ดรอปที่ active | `getCurrentDrop()` สมมติมีได้ทีละ 1 | ขาย 2 ตัวละครพร้อมกันไม่ได้ |
| การจ่ายเงิน | `config.promptpay_id` ตัวเดียวทั้งระบบ | แต่ละตัวละครใช้พร้อมเพย์คนละอันไม่ได้ |
| ห้องชำระเงิน | ผูกกับ item ตายตัว (`pay-slot-N`) | ลายเยอะ → ห้องเยอะเกิน (Discord จำกัด ~500 ห้อง/เซิร์ฟเวอร์) |

**สิ่งที่ v1 ทำไว้ดีแล้ว (คงไว้ทั้งหมด):** เงินเป็น satang, ตำแหน่งคิวคำนวณจาก `seq` (ไม่ store), `UNIQUE(item_id,user_id)` กันคิว #1 ซ้ำ, mutex ต่อ item — **ทั้งหมดนี้ยังใช้ได้กับ v2 ไม่ต้องแก้** เพราะ concurrency ทำงานที่ระดับ "item" ซึ่งยังเป็นหน่วยอิสระเหมือนเดิม

---

## โครงสร้างใหม่ (ERD ย่อ)

```
characters (ใหม่)
   1───∞ drops ──1───∞ items ──1───∞ queue_entries
                        │
                        1───1 tickets ──∞───1 cashier_channels (pool, ใหม่)
items ──1───∞ won_orders
```

### 1. `characters` (ตารางใหม่ — หัวใจของ v2)

```sql
CREATE TABLE IF NOT EXISTS characters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,           -- "Delta", "Shizu"
  handle        TEXT    NOT NULL UNIQUE,    -- slug สำหรับตั้งชื่อห้อง เช่น "delta"
  promptpay_id  TEXT,                       -- พร้อมเพย์เฉพาะตัวละคร (null = ใช้ config กลาง)
  qr_image_path TEXT,                       -- รูป QR เฉพาะตัวละคร (null = ใช้ config กลาง)
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);
```

### 2. `drops` (เพิ่ม `character_id`, `title`)

```sql
CREATE TABLE IF NOT EXISTS drops (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id     INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,  -- ใหม่
  title            TEXT,                    -- ใหม่: "เซ็ตหน้าร้อน 2026"
  state            TEXT NOT NULL DEFAULT 'setup'
                     CHECK (state IN ('setup','scheduled','teasing','live','done','cancelled')),
  publish_at       INTEGER, teaser_at INTEGER,
  panel_channel_id TEXT, panel_message_id TEXT,
  created_at       INTEGER NOT NULL, published_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_drops_char_state ON drops (character_id, state);
```

หลายดรอป active พร้อมกันได้ → เลิกใช้ `getCurrentDrop()` เดี่ยว เปลี่ยนเป็น:
- `getActiveDropForCharacter(characterId)` — ดรอปที่ยังไม่จบของตัวละครนั้น
- `getActiveDrops()` — ทุกดรอปที่ active (สำหรับ dashboard/rehydrate)

### 3. `items` (จำนวนลายยืดหยุ่น + `code`)

```sql
CREATE TABLE IF NOT EXISTS items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id           INTEGER NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  slot              INTEGER NOT NULL,       -- ลำดับแสดง (จำนวนกี่ลายก็ได้ ไม่ตายที่ 5)
  code              TEXT,                   -- ป้ายบนการ์ด เช่น "R1"
  title             TEXT, description TEXT, price_satang INTEGER,
  image_path        TEXT, image_filename TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','available','reserved','sold')),
  public_message_id TEXT, teaser_message_id TEXT,
  buyer_user_id     TEXT, sold_at INTEGER,
  UNIQUE (drop_id, slot)
);
```
เปลี่ยนหลักๆ อยู่ที่ **โค้ด** ไม่ใช่ schema: `createDrop(characterId, count)` แทนการวน 1..5 ตายตัว และ setup panel เพิ่มปุ่ม "เพิ่มลาย/ลบลาย"

### 4. `queue_entries`, `seq_counter` — **ไม่เปลี่ยน**

`seq` เป็น global monotonic อยู่แล้ว ตำแหน่งคำนวณต่อ item → ใช้ข้ามตัวละคร/ดรอปได้ทันที `UNIQUE(item_id,user_id)` ยังกันคิวซ้ำได้เหมือนเดิม

### 5. ห้องชำระเงิน — เปลี่ยนเป็น **channel pool** (แก้เรื่องห้องล้น)

แทนที่จะมี 1 ห้องตายตัวต่อ item ให้มี **pool ของห้องที่ใช้ซ้ำ** จองให้ item ที่มีคิว #1 อยู่ แล้วคืน pool เมื่อขายจบ → จำนวนห้อง = "จำนวนคนที่กำลังจ่ายพร้อมกัน" ไม่ใช่ "จำนวนลายทั้งหมด"

```sql
-- pool ของห้อง cashier ที่ใช้ซ้ำได้
CREATE TABLE IF NOT EXISTS cashier_channels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL UNIQUE,
  item_id    INTEGER REFERENCES items(id) ON DELETE SET NULL,  -- null = ว่าง
  updated_at INTEGER
);

-- tickets: ยังผูก 1:1 กับ item (state/buyer/qr) แต่ channel_id ชี้ห้องที่ "จอง" จาก pool
CREATE TABLE IF NOT EXISTS tickets (
  item_id       INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  channel_id    TEXT,                 -- ห้องที่จองอยู่ตอนนี้ (จาก pool) หรือ null
  buyer_user_id TEXT,
  state         TEXT NOT NULL DEFAULT 'idle'
                  CHECK (state IN ('idle','awaiting_payment','awaiting_review','closed')),
  qr_message_id TEXT, created_at INTEGER, updated_at INTEGER
);
```

**Allocation logic (แก้ใน `ticketService.assign`):**
1. item ได้ #1 → หา `cashier_channels` ที่ว่าง (`item_id IS NULL`); ถ้าไม่มีและ pool ยังไม่ถึงเพดาน → สร้างห้องใหม่เข้า pool
2. จองห้อง: `cashier_channels.item_id = itemId`, `tickets.channel_id = channel`
3. ตั้งชื่อ/หัวข้อห้องแบบไดนามิกตามตัวละคร+ลาย: เช่น `cashier-1` (ชื่อ pool) แล้ว rename topic → `Delta · R1`
4. ขายจบ/คิวว่าง → คืน pool (`item_id = NULL`), `bulkDelete` ประวัติ, ปลดสิทธิ์ผู้ซื้อ

> **ทางเลือกที่ง่ายกว่า (ถ้ายอดขายไม่สูง):** คงโมเดล v1 (สร้างห้องตอนมีคิว #1) แต่ **ลบห้องทันทีที่ขายจบ** แทนการเก็บไว้ → จำนวนห้องก็ไม่ล้นเหมือนกัน ไม่ต้องทำ pool table เพิ่ม เริ่มจากอันนี้ก่อนได้

### 6. `won_orders` — เพิ่ม `character_id` (ไว้ทำรายงานต่อตัวละคร)

```sql
ALTER TABLE won_orders ADD COLUMN character_id INTEGER;
```

### 7. `config` — คงเดิม (เป็น default กลาง)

`promptpay_id`/`qr_image_path` ใน `config` กลายเป็น **ค่า fallback** เมื่อ `characters.promptpay_id` เป็น null → โค้ด `qrService`/`ticketService` เลือก per-character ก่อน แล้วค่อย fallback config

---

## แผน Migration (v1 → v2) — แบบไม่ทำข้อมูลหาย

db.js มี pattern `ensureColumn` + `CREATE TABLE IF NOT EXISTS` อยู่แล้ว ทำเพิ่มได้ปลอดภัย:

1. `CREATE TABLE characters` + insert **ตัวละคร default (id=1)** จาก `config` เดิม (name=ชื่อร้าน, promptpay=config.promptpay_id)
2. `ensureColumn('drops','character_id','INTEGER')` → `UPDATE drops SET character_id=1 WHERE character_id IS NULL`
3. `ensureColumn('drops','title','TEXT')`, `ensureColumn('items','code','TEXT')`, `ensureColumn('won_orders','character_id','INTEGER')`
4. `CREATE TABLE cashier_channels` (ว่าง — เริ่ม pool ใหม่)
5. ดรอป/ออเดอร์เก่าทั้งหมดถูกผูกกับตัวละคร default อัตโนมัติ → ระบบเดิมทำงานต่อได้ไม่สะดุด

---

## รายการงานฝั่งโค้ด (ประเมิน scope)

| ไฟล์ | แก้อะไร |
|---|---|
| `db/schema.sql` + `db/db.js` | เพิ่มตาราง/คอลัมน์ + migration ตามบน |
| `db/repo.js` | เพิ่ม CRUD ตัวละคร; `createDrop(characterId,count)`; `getActiveDropForCharacter`/`getActiveDrops`; per-character promptpay lookup; channel-pool CRUD |
| `commands/cheki.js` | `/cheki character add/list`; ให้ `init`/`image` ระบุตัวละคร; เลือกจำนวนลาย |
| `interactions/setupPanel.js` + `setupButtons.js` | ปุ่มเพิ่ม/ลบลาย; แผงต่อตัวละคร |
| `services/dropService.js` | rehydrate จาก `getActiveDrops()` (หลายดรอป) |
| `services/ticketService.js` | channel-pool allocation/return + ชื่อห้องไดนามิก |
| `services/qrService.js` / `embedService.js` | ใช้พร้อมเพย์/ป้าย per-character |
| `admin/server.js` + dashboard | group ตาม character; แสดง "ตัวละคร → ลาย → ห้อง" |

**ไม่ต้องแตะ:** `lib/mutex.js`, `lib/time.js`, ตรรกะ `seq`/position, `UNIQUE(item_id,user_id)` — โครง concurrency เดิมรองรับ v2 อยู่แล้ว

---

## ลำดับที่แนะนำให้ทำ (ค่อยเป็นค่อยไป)

1. **Phase A** — เปิดใช้ dashboard บนระบบ v1 ปัจจุบันก่อน (เสร็จแล้ว) เก็บ feedback การใช้งานจริง
2. **Phase B** — เพิ่ม `characters` + per-character promptpay + drop หลายตัวพร้อมกัน (schema เพิ่มแบบ additive)
3. **Phase C** — จำนวนลายยืดหยุ่น + channel pool (ตอนที่แคตตาล็อกเริ่มใหญ่จริง)

แต่ละ phase migrate แบบ additive ไม่ทำ v1 พัง และเทสต์ด้วย `scripts/smoketest.js` (ต่อยอด test เพิ่มได้)

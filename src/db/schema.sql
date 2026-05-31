-- Cheki Drop Bot schema. Money is stored as integer satang (THB * 100) to avoid
-- floating point. Status fields are TEXT with CHECK constraints so the DB is
-- readable/inspectable from the sqlite3 CLI.

-- Single-row operational config (id always = 1). Set via /cheki config + init.
CREATE TABLE IF NOT EXISTS config (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  guild_id            TEXT    NOT NULL,
  admin_role_id       TEXT,
  announce_channel_id TEXT,   -- public channel where the drop is posted
  setup_channel_id    TEXT,   -- admin-only channel holding the control panel
  ticket_category_id  TEXT,   -- category under which private channels are created
  promptpay_id        TEXT,   -- phone number or 13-digit national id
  updated_at          INTEGER NOT NULL
);

-- A drop = one batch of (up to) 5 designs.
CREATE TABLE IF NOT EXISTS drops (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  state            TEXT    NOT NULL DEFAULT 'setup'
                     CHECK (state IN ('setup','scheduled','teasing','live','done','cancelled')),
  publish_at       INTEGER,     -- unix seconds; null until scheduled
  teaser_at        INTEGER,     -- unix seconds; when the teaser posts
  panel_channel_id TEXT,        -- setup control panel location
  panel_message_id TEXT,        -- setup control panel message id
  created_at       INTEGER NOT NULL,
  published_at     INTEGER
);

-- The designs of a drop (slots 1..5).
CREATE TABLE IF NOT EXISTS items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id           INTEGER NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  slot              INTEGER NOT NULL,            -- 1..5 ordering within the drop
  title             TEXT,
  description       TEXT,
  price_satang      INTEGER,                     -- THB * 100
  image_path        TEXT,                        -- local file path under data/images
  image_filename    TEXT,                        -- original filename (for extension)
  status            TEXT    NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','available','reserved','sold')),
  public_message_id TEXT,                        -- the live sale embed message id
  teaser_message_id TEXT,                        -- teaser message id (edited at reveal)
  buyer_user_id     TEXT,                        -- final confirmed buyer (set on sold)
  sold_at           INTEGER,
  UNIQUE (drop_id, slot)
);

-- Waitlist entries. Position is DERIVED at read time from `seq` ordering, never
-- stored, so cancels never trigger a renumber race. One row per (item,user).
CREATE TABLE IF NOT EXISTS queue_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL,
  seq        INTEGER NOT NULL,        -- global monotonic; lower = earlier
  state      TEXT    NOT NULL DEFAULT 'waiting'
               CHECK (state IN ('waiting','active','won','left','skipped')),
  joined_at  INTEGER NOT NULL,
  UNIQUE (item_id, user_id)
);

-- Monotonic counter source (single row) for queue ordering.
CREATE TABLE IF NOT EXISTS seq_counter (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  val  INTEGER NOT NULL
);

-- Private payment channels, one per item at a time.
CREATE TABLE IF NOT EXISTS tickets (
  item_id        INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  channel_id     TEXT,                  -- null = not yet created
  buyer_user_id  TEXT,                  -- current #1 occupying the channel
  state          TEXT NOT NULL DEFAULT 'idle'
                   CHECK (state IN ('idle','awaiting_payment','awaiting_review','closed')),
  qr_message_id  TEXT,                  -- control/QR message id (holds admin buttons)
  created_at     INTEGER,
  updated_at     INTEGER
);

-- Order history snapshot, written at confirm time so cleanup never loses data.
CREATE TABLE IF NOT EXISTS won_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  drop_id        INTEGER,
  slot           INTEGER,
  title          TEXT,
  buyer_user_id  TEXT NOT NULL,
  price_satang   INTEGER,
  shipping_note  TEXT,
  sold_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_item_order ON queue_entries (item_id, state, seq);
CREATE INDEX IF NOT EXISTS idx_queue_item_user  ON queue_entries (item_id, user_id);
CREATE INDEX IF NOT EXISTS idx_items_drop       ON items (drop_id);
CREATE INDEX IF NOT EXISTS idx_drops_state      ON drops (state);

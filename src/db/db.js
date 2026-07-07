'use strict';

// Opens the SQLite database, applies pragmas, runs the schema (idempotent), and
// seeds singleton rows. Exports the better-sqlite3 Database instance.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../logger');

// Ensure the data directory (and images dir) exist before opening the file.
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.imagesDir, { recursive: true });

const db = new Database(config.dbPath);

// WAL = concurrent reads + durable writes; the rest are standard for a small,
// single-process app.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// Apply schema (CREATE TABLE IF NOT EXISTS ... is safe to re-run on every boot).
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Lightweight migrations: CREATE TABLE IF NOT EXISTS never adds columns to an
// existing table, so add any new columns to already-deployed databases here.
// (table/column are static literals — no injection risk.)
function ensureColumn(table, column, typeDdl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDdl}`);
    logger.info(`Migrated: added ${table}.${column}`);
  }
}
ensureColumn('config', 'qr_image_path', 'TEXT');
ensureColumn('won_orders', 'tracking_no', 'TEXT');
ensureColumn('won_orders', 'tracking_sent_at', 'INTEGER');
ensureColumn('won_orders', 'tracking_carrier', 'TEXT');
// Per-drop display name (e.g. "Stelle - Drop") and its own announce channel
// (overrides config.announce_channel_id so each drop can post to its own room).
ensureColumn('drops', 'name', 'TEXT');
ensureColumn('drops', 'announce_channel_id', 'TEXT');

// Seed the monotonic counter row once.
db.prepare('INSERT OR IGNORE INTO seq_counter (id, val) VALUES (1, 0)').run();

logger.info(`SQLite ready at ${config.dbPath}`);

module.exports = db;

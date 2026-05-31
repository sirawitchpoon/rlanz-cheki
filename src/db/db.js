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

// Seed the monotonic counter row once.
db.prepare('INSERT OR IGNORE INTO seq_counter (id, val) VALUES (1, 0)').run();

logger.info(`SQLite ready at ${config.dbPath}`);

module.exports = db;

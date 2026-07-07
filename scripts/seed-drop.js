'use strict';

// One-off seed: reconstruct a PAST, already-sold drop into the DB so the bot
// knows buyer <-> design <-> cashier-channel and can post follow-ups (e.g. a
// tracking number) into each buyer's existing private channel.
//
// Run:   node scripts/seed-drop.js
// Re-run guard: refuses if any drop already exists unless FORCE=1.
//
// Edit the DATA block below for future reconstructions.

require('../src/config'); // loads .env (needs DISCORD_TOKEN/APP_ID/GUILD_ID present)
const db = require('../src/db/db');
const { parseBangkok, nowSeconds } = require('../src/lib/time');

// ---- DATA (edit me) -------------------------------------------------------
// Fill these with real Discord user/channel IDs LOCALLY before running.
// Do NOT commit real customer IDs — keep them out of version control.
const PUBLISH_AT = parseBangkok('2026-01-01 19:00'); // Asia/Bangkok
const PRICE_SATANG = 25000; // ฿250.00
const DESIGNS = [
  { slot: 1, code: 'R1', buyer: 'BUYER_DISCORD_ID_1', channel: 'CASHIER_CHANNEL_ID_1' },
  { slot: 2, code: 'R2', buyer: 'BUYER_DISCORD_ID_2', channel: 'CASHIER_CHANNEL_ID_2' },
  { slot: 3, code: 'R3', buyer: 'BUYER_DISCORD_ID_3', channel: 'CASHIER_CHANNEL_ID_3' },
  { slot: 4, code: 'R4', buyer: 'BUYER_DISCORD_ID_4', channel: 'CASHIER_CHANNEL_ID_4' },
];
// ---------------------------------------------------------------------------

const existing = db.prepare('SELECT COUNT(*) c FROM drops').get().c;
if (existing > 0 && process.env.FORCE !== '1') {
  console.error(`Refusing: ${existing} drop(s) already exist. Re-run with FORCE=1 to seed anyway.`);
  process.exit(1);
}

const soldAt = PUBLISH_AT + 60; // ~1 min after open

const seed = db.transaction(() => {
  // drop (all sold -> state 'done')
  const dropId = Number(
    db.prepare(
      "INSERT INTO drops (state, publish_at, teaser_at, created_at, published_at) VALUES ('done', ?, NULL, ?, ?)",
    ).run(PUBLISH_AT, PUBLISH_AT, PUBLISH_AT).lastInsertRowid,
  );

  const insItem = db.prepare(
    "INSERT INTO items (drop_id, slot, title, price_satang, status, buyer_user_id, sold_at) VALUES (?, ?, ?, ?, 'sold', ?, ?)",
  );
  const insTicket = db.prepare(
    "INSERT INTO tickets (item_id, channel_id, buyer_user_id, state, created_at, updated_at) VALUES (?, ?, ?, 'closed', ?, ?)",
  );
  const nextSeq = db.prepare('UPDATE seq_counter SET val = val + 1 WHERE id = 1 RETURNING val');
  const insEntry = db.prepare(
    "INSERT INTO queue_entries (item_id, user_id, seq, state, joined_at) VALUES (?, ?, ?, 'won', ?)",
  );
  const insOrder = db.prepare(
    'INSERT INTO won_orders (item_id, drop_id, slot, title, buyer_user_id, price_satang, shipping_note, sold_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
  );

  for (const d of DESIGNS) {
    const itemId = Number(insItem.run(dropId, d.slot, d.code, PRICE_SATANG, d.buyer, soldAt).lastInsertRowid);
    insTicket.run(itemId, d.channel, d.buyer, PUBLISH_AT, soldAt);
    insEntry.run(itemId, d.buyer, nextSeq.get().val, soldAt);
    insOrder.run(itemId, dropId, d.slot, d.code, d.buyer, PRICE_SATANG, soldAt);
  }
  return dropId;
});

const dropId = seed();
console.log(`Seeded drop #${dropId} with ${DESIGNS.length} sold designs.`);
console.table(
  db.prepare(
    `SELECT i.slot, i.title, i.status, i.buyer_user_id AS buyer, t.channel_id AS channel
       FROM items i JOIN tickets t ON t.item_id = i.id WHERE i.drop_id = ? ORDER BY i.slot`,
  ).all(dropId),
);

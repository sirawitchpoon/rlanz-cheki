'use strict';

// Data access layer. ALL SQL lives here. Higher layers (services/commands) call
// these functions and never touch the db handle directly. Transactions that
// must be atomic (reserve / cancel / advance / confirm) are defined with
// db.transaction(...) and exported as functions.
const db = require('./db');
const { nowSeconds } = require('../lib/time');

/* ----------------------------- prepared stmts ---------------------------- */

const stmt = {
  // config
  getConfig: db.prepare('SELECT * FROM config WHERE id = 1'),
  insertConfig: db.prepare(`
    INSERT INTO config (id, guild_id, admin_role_id, announce_channel_id,
                        setup_channel_id, ticket_category_id, promptpay_id, qr_image_path, updated_at)
    VALUES (1, @guild_id, @admin_role_id, @announce_channel_id,
            @setup_channel_id, @ticket_category_id, @promptpay_id, @qr_image_path, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      guild_id            = excluded.guild_id,
      admin_role_id       = excluded.admin_role_id,
      announce_channel_id = excluded.announce_channel_id,
      setup_channel_id    = excluded.setup_channel_id,
      ticket_category_id  = excluded.ticket_category_id,
      promptpay_id        = excluded.promptpay_id,
      qr_image_path       = excluded.qr_image_path,
      updated_at          = excluded.updated_at
  `),

  // drops
  insertDrop: db.prepare("INSERT INTO drops (state, created_at) VALUES ('setup', ?)"),
  getDrop: db.prepare('SELECT * FROM drops WHERE id = ?'),
  getCurrentDrop: db.prepare(
    "SELECT * FROM drops WHERE state NOT IN ('done','cancelled') ORDER BY id DESC LIMIT 1",
  ),
  getLatestDrop: db.prepare('SELECT * FROM drops ORDER BY id DESC LIMIT 1'),
  getAllDrops: db.prepare('SELECT * FROM drops ORDER BY id DESC LIMIT 100'),
  getDropsToRehydrate: db.prepare(
    "SELECT * FROM drops WHERE state IN ('scheduled','teasing','live')",
  ),
  setDropState: db.prepare('UPDATE drops SET state = ? WHERE id = ?'),
  setDropName: db.prepare('UPDATE drops SET name = ? WHERE id = ?'),
  setDropAnnounceChannel: db.prepare('UPDATE drops SET announce_channel_id = ? WHERE id = ?'),
  setDropTimes: db.prepare('UPDATE drops SET publish_at = ?, teaser_at = ? WHERE id = ?'),
  setDropPanel: db.prepare(
    'UPDATE drops SET panel_channel_id = ?, panel_message_id = ? WHERE id = ?',
  ),
  setDropPublished: db.prepare(
    "UPDATE drops SET state = 'live', published_at = ? WHERE id = ?",
  ),

  // items
  insertItem: db.prepare(
    "INSERT INTO items (drop_id, slot, status) VALUES (?, ?, 'draft')",
  ),
  getItem: db.prepare('SELECT * FROM items WHERE id = ?'),
  getItemsByDrop: db.prepare('SELECT * FROM items WHERE drop_id = ? ORDER BY slot ASC'),
  getItemBySlot: db.prepare('SELECT * FROM items WHERE drop_id = ? AND slot = ?'),
  updateItemDetails: db.prepare(
    'UPDATE items SET title = @title, description = @description, price_satang = @price_satang WHERE id = @id',
  ),
  setItemImage: db.prepare(
    'UPDATE items SET image_path = ?, image_filename = ? WHERE id = ?',
  ),
  setItemStatus: db.prepare('UPDATE items SET status = ? WHERE id = ?'),
  setItemPublicMessage: db.prepare('UPDATE items SET public_message_id = ? WHERE id = ?'),
  setItemTeaserMessage: db.prepare('UPDATE items SET teaser_message_id = ? WHERE id = ?'),
  setItemSold: db.prepare(
    "UPDATE items SET status = 'sold', buyer_user_id = ?, sold_at = ? WHERE id = ?",
  ),
  countSoldInDrop: db.prepare(
    "SELECT COUNT(*) AS c FROM items WHERE drop_id = ? AND status = 'sold'",
  ),
  countItemsInDrop: db.prepare('SELECT COUNT(*) AS c FROM items WHERE drop_id = ?'),

  // queue
  nextSeq: db.prepare('UPDATE seq_counter SET val = val + 1 WHERE id = 1 RETURNING val'),
  getQueueEntry: db.prepare(
    'SELECT * FROM queue_entries WHERE item_id = ? AND user_id = ?',
  ),
  insertEntry: db.prepare(
    'INSERT INTO queue_entries (item_id, user_id, seq, state, joined_at) VALUES (?, ?, ?, ?, ?)',
  ),
  deleteEntry: db.prepare('DELETE FROM queue_entries WHERE id = ?'),
  setEntryState: db.prepare('UPDATE queue_entries SET state = ? WHERE id = ?'),
  getActiveEntry: db.prepare(
    "SELECT * FROM queue_entries WHERE item_id = ? AND state = 'active' LIMIT 1",
  ),
  firstWaiting: db.prepare(
    "SELECT * FROM queue_entries WHERE item_id = ? AND state = 'waiting' ORDER BY seq ASC LIMIT 1",
  ),
  positionOfSeq: db.prepare(
    "SELECT COUNT(*) AS c FROM queue_entries WHERE item_id = ? AND state IN ('waiting','active') AND seq <= ?",
  ),
  countQueue: db.prepare(
    "SELECT COUNT(*) AS c FROM queue_entries WHERE item_id = ? AND state IN ('waiting','active')",
  ),
  activeEntriesForUser: db.prepare(
    "SELECT * FROM queue_entries WHERE user_id = ? AND state = 'active'",
  ),

  // tickets
  insertTicket: db.prepare(
    "INSERT INTO tickets (item_id, state, updated_at) VALUES (?, 'idle', ?)",
  ),
  getTicket: db.prepare('SELECT * FROM tickets WHERE item_id = ?'),
  getTicketByChannel: db.prepare('SELECT * FROM tickets WHERE channel_id = ?'),
  getTicketsByDrop: db.prepare(`
    SELECT t.* FROM tickets t JOIN items i ON i.id = t.item_id WHERE i.drop_id = ?
  `),
  setTicketChannel: db.prepare(
    'UPDATE tickets SET channel_id = ?, updated_at = ? WHERE item_id = ?',
  ),
  setTicketBuyer: db.prepare(
    'UPDATE tickets SET buyer_user_id = ?, updated_at = ? WHERE item_id = ?',
  ),
  setTicketState: db.prepare(
    'UPDATE tickets SET state = ?, updated_at = ? WHERE item_id = ?',
  ),
  setTicketQrMessage: db.prepare(
    'UPDATE tickets SET qr_message_id = ?, updated_at = ? WHERE item_id = ?',
  ),

  // won_orders
  insertWonOrder: db.prepare(`
    INSERT INTO won_orders (item_id, drop_id, slot, title, buyer_user_id, price_satang, shipping_note, sold_at)
    VALUES (@item_id, @drop_id, @slot, @title, @buyer_user_id, @price_satang, @shipping_note, @sold_at)
  `),
  getOrdersByDrop: db.prepare('SELECT * FROM won_orders WHERE drop_id = ? ORDER BY slot ASC'),
  getAllOrders: db.prepare('SELECT * FROM won_orders ORDER BY sold_at DESC'),
  getOrderByItem: db.prepare('SELECT * FROM won_orders WHERE item_id = ? ORDER BY id DESC LIMIT 1'),
  setOrderTracking: db.prepare(
    'UPDATE won_orders SET tracking_no = ?, tracking_carrier = ?, tracking_sent_at = ? WHERE item_id = ?',
  ),
  setOrderRecipient: db.prepare('UPDATE won_orders SET recipient_name = ? WHERE item_id = ?'),
};

/* -------------------------------- config --------------------------------- */

function getConfig() {
  return stmt.getConfig.get() || null;
}

// Merge-update the singleton config row. Pass any subset of fields.
function upsertConfig(patch) {
  const current = getConfig() || {};
  const row = {
    guild_id: patch.guild_id ?? current.guild_id ?? null,
    admin_role_id: patch.admin_role_id ?? current.admin_role_id ?? null,
    announce_channel_id: patch.announce_channel_id ?? current.announce_channel_id ?? null,
    setup_channel_id: patch.setup_channel_id ?? current.setup_channel_id ?? null,
    ticket_category_id: patch.ticket_category_id ?? current.ticket_category_id ?? null,
    promptpay_id: patch.promptpay_id ?? current.promptpay_id ?? null,
    qr_image_path: patch.qr_image_path ?? current.qr_image_path ?? null,
    updated_at: nowSeconds(),
  };
  if (!row.guild_id) throw new Error('config.guild_id is required');
  stmt.insertConfig.run(row);
  return getConfig();
}

/* --------------------------------- drops --------------------------------- */

function getDrop(id) {
  return stmt.getDrop.get(id) || null;
}
function getCurrentDrop() {
  return stmt.getCurrentDrop.get() || null;
}
function getLatestDrop() {
  return stmt.getLatestDrop.get() || null;
}
function getAllDrops() {
  return stmt.getAllDrops.all();
}
function getDropsToRehydrate() {
  return stmt.getDropsToRehydrate.all();
}
function setDropState(id, state) {
  stmt.setDropState.run(state, id);
}
function setDropName(id, name) {
  stmt.setDropName.run(name, id);
}
function setDropAnnounceChannel(id, channelId) {
  stmt.setDropAnnounceChannel.run(channelId, id);
}
// The channel a drop posts to: its own override, else the global config channel.
function announceChannelFor(drop) {
  if (drop && drop.announce_channel_id) return drop.announce_channel_id;
  const cfg = getConfig();
  return cfg ? cfg.announce_channel_id : null;
}
function setDropTimes(id, publishAt, teaserAt) {
  stmt.setDropTimes.run(publishAt, teaserAt, id);
}
function setDropPanel(id, channelId, messageId) {
  stmt.setDropPanel.run(channelId, messageId, id);
}
function setDropPublished(id) {
  stmt.setDropPublished.run(nowSeconds(), id);
}

// Create a fresh drop with `count` placeholder items (default 5, clamped 1..20)
// and their ticket rows.
const createDropWithItems = db.transaction((count = 5) => {
  const n = Math.max(1, Math.min(20, Number(count) || 5));
  const info = stmt.insertDrop.run(nowSeconds());
  const dropId = Number(info.lastInsertRowid);
  for (let slot = 1; slot <= n; slot += 1) {
    const itemInfo = stmt.insertItem.run(dropId, slot);
    stmt.insertTicket.run(Number(itemInfo.lastInsertRowid), nowSeconds());
  }
  return dropId;
});

/* --------------------------------- items --------------------------------- */

function getItem(id) {
  return stmt.getItem.get(id) || null;
}
function getItemsByDrop(dropId) {
  return stmt.getItemsByDrop.all(dropId);
}
function getItemBySlot(dropId, slot) {
  return stmt.getItemBySlot.get(dropId, slot) || null;
}
function updateItemDetails(id, { title, description, priceSatang }) {
  stmt.updateItemDetails.run({ id, title, description, price_satang: priceSatang });
}
function setItemImage(id, imagePath, filename) {
  stmt.setItemImage.run(imagePath, filename, id);
}
function setItemStatus(id, status) {
  stmt.setItemStatus.run(status, id);
}
function setItemPublicMessage(id, messageId) {
  stmt.setItemPublicMessage.run(messageId, id);
}
function setItemTeaserMessage(id, messageId) {
  stmt.setItemTeaserMessage.run(messageId, id);
}
function countSoldInDrop(dropId) {
  return stmt.countSoldInDrop.get(dropId).c;
}
function countItemsInDrop(dropId) {
  return stmt.countItemsInDrop.get(dropId).c;
}

// True when every item of a drop has a title, price and image set.
function isDropComplete(dropId) {
  const items = getItemsByDrop(dropId);
  if (items.length === 0) return false;
  return items.every(
    (it) => it.title && it.price_satang != null && it.image_path,
  );
}

/* --------------------------------- queue --------------------------------- */

function getQueueEntry(itemId, userId) {
  return stmt.getQueueEntry.get(itemId, userId) || null;
}
function positionOfSeq(itemId, seq) {
  return stmt.positionOfSeq.get(itemId, seq).c;
}
function countQueue(itemId) {
  return stmt.countQueue.get(itemId).c;
}
function getActiveEntry(itemId) {
  return stmt.getActiveEntry.get(itemId) || null;
}
function activeEntriesForUser(userId) {
  return stmt.activeEntriesForUser.all(userId);
}

// Returns the user's current position (1-based) or null if not queued.
function positionOfUser(itemId, userId) {
  const entry = getQueueEntry(itemId, userId);
  if (!entry || !(entry.state === 'waiting' || entry.state === 'active')) return null;
  return positionOfSeq(itemId, entry.seq);
}

/* ------------------------- atomic queue transactions --------------------- */

// Join the waitlist. Returns one of:
//   { error:'no_item' } | { sold:true } | { already:true, position, active }
//   | { position, becameFirst }
const reserve = db.transaction((itemId, userId) => {
  const item = stmt.getItem.get(itemId);
  if (!item) return { error: 'no_item' };
  if (item.status === 'sold') return { sold: true };

  const existing = stmt.getQueueEntry.get(itemId, userId);
  if (existing && (existing.state === 'waiting' || existing.state === 'active')) {
    return {
      already: true,
      position: positionOfSeq(itemId, existing.seq),
      active: existing.state === 'active',
    };
  }
  // A previously left/skipped user may re-join at the back; clear the stale row
  // so the UNIQUE(item,user) constraint allows the new insert.
  if (existing) stmt.deleteEntry.run(existing.id);

  const seq = stmt.nextSeq.get().val;
  const info = stmt.insertEntry.run(itemId, userId, seq, 'waiting', nowSeconds());
  const entryId = Number(info.lastInsertRowid);
  const position = positionOfSeq(itemId, seq);
  const becameFirst = position === 1 && item.status === 'available';
  if (becameFirst) {
    stmt.setEntryState.run('active', entryId);
    stmt.setItemStatus.run('reserved', itemId);
  }
  return { position, becameFirst };
});

// Leave the queue. Returns:
//   { notInQueue:true } | { wasActive:false } | { wasActive:true, nextUserId }
const cancel = db.transaction((itemId, userId) => {
  const entry = stmt.getQueueEntry.get(itemId, userId);
  if (!entry || ['left', 'skipped', 'won'].includes(entry.state)) {
    return { notInQueue: true };
  }
  if (entry.state === 'waiting') {
    stmt.setEntryState.run('left', entry.id);
    return { wasActive: false };
  }
  // active #1 leaving -> advance the queue
  stmt.setEntryState.run('left', entry.id);
  const next = stmt.firstWaiting.get(itemId);
  if (next) {
    stmt.setEntryState.run('active', next.id);
    return { wasActive: true, nextUserId: next.user_id };
  }
  stmt.setItemStatus.run('available', itemId);
  return { wasActive: true, nextUserId: null };
});

// Admin skip of the current #1. Returns { error } | { sold:true } | { nextUserId }
const releaseAndAdvance = db.transaction((itemId) => {
  const item = stmt.getItem.get(itemId);
  if (!item) return { error: 'no_item' };
  if (item.status === 'sold') return { sold: true };
  const active = stmt.getActiveEntry.get(itemId);
  if (active) stmt.setEntryState.run('skipped', active.id);
  const next = stmt.firstWaiting.get(itemId);
  if (next) {
    stmt.setEntryState.run('active', next.id);
    stmt.setItemStatus.run('reserved', itemId);
    return { nextUserId: next.user_id };
  }
  stmt.setItemStatus.run('available', itemId);
  return { nextUserId: null };
});

// Confirm the sale to the current buyer. Returns { error } | { already:true } | { ok:true, item }
const confirmSold = db.transaction((itemId, buyerUserId, shippingNote) => {
  const item = stmt.getItem.get(itemId);
  if (!item) return { error: 'no_item' };
  if (item.status === 'sold') return { already: true };
  const soldAt = nowSeconds();
  stmt.setItemSold.run(buyerUserId, soldAt, itemId);
  const active = stmt.getActiveEntry.get(itemId);
  if (active) stmt.setEntryState.run('won', active.id);
  stmt.setTicketState.run('closed', nowSeconds(), itemId);
  stmt.insertWonOrder.run({
    item_id: itemId,
    drop_id: item.drop_id,
    slot: item.slot,
    title: item.title,
    buyer_user_id: buyerUserId,
    price_satang: item.price_satang,
    shipping_note: shippingNote || null,
    sold_at: soldAt,
  });
  return { ok: true, item };
});

/* -------------------------------- tickets -------------------------------- */

function getTicket(itemId) {
  return stmt.getTicket.get(itemId) || null;
}
function getTicketByChannel(channelId) {
  return stmt.getTicketByChannel.get(channelId) || null;
}
function getTicketsByDrop(dropId) {
  return stmt.getTicketsByDrop.all(dropId);
}
function setTicketChannel(itemId, channelId) {
  stmt.setTicketChannel.run(channelId, nowSeconds(), itemId);
}
function setTicketBuyer(itemId, buyerUserId) {
  stmt.setTicketBuyer.run(buyerUserId, nowSeconds(), itemId);
}
function setTicketState(itemId, state) {
  stmt.setTicketState.run(state, nowSeconds(), itemId);
}
function setTicketQrMessage(itemId, messageId) {
  stmt.setTicketQrMessage.run(messageId, nowSeconds(), itemId);
}

/* ------------------------------- won_orders ------------------------------ */

function getOrdersByDrop(dropId) {
  return stmt.getOrdersByDrop.all(dropId);
}
function getAllOrders() {
  return stmt.getAllOrders.all();
}
function getOrderByItem(itemId) {
  return stmt.getOrderByItem.get(itemId) || null;
}
function setOrderTracking(itemId, trackingNo, carrier) {
  stmt.setOrderTracking.run(trackingNo, carrier || null, nowSeconds(), itemId);
}
function setOrderRecipient(itemId, name) {
  stmt.setOrderRecipient.run(name || null, itemId);
}

module.exports = {
  // config
  getConfig,
  upsertConfig,
  // drops
  getDrop,
  getCurrentDrop,
  getLatestDrop,
  getAllDrops,
  getDropsToRehydrate,
  setDropState,
  setDropName,
  setDropAnnounceChannel,
  announceChannelFor,
  setDropTimes,
  setDropPanel,
  setDropPublished,
  createDropWithItems,
  // items
  getItem,
  getItemsByDrop,
  getItemBySlot,
  updateItemDetails,
  setItemImage,
  setItemStatus,
  setItemPublicMessage,
  setItemTeaserMessage,
  countSoldInDrop,
  countItemsInDrop,
  isDropComplete,
  // queue (reads)
  getQueueEntry,
  positionOfSeq,
  positionOfUser,
  countQueue,
  getActiveEntry,
  activeEntriesForUser,
  // queue (atomic transactions)
  reserve,
  cancel,
  releaseAndAdvance,
  confirmSold,
  // tickets
  getTicket,
  getTicketByChannel,
  getTicketsByDrop,
  setTicketChannel,
  setTicketBuyer,
  setTicketState,
  setTicketQrMessage,
  // orders
  getOrdersByDrop,
  getAllOrders,
  getOrderByItem,
  setOrderTracking,
  setOrderRecipient,
};

'use strict';

// Orchestrates the queue: wraps the atomic repo transactions in a per-item
// mutex and performs the Discord-side side effects (assign/lock private channel,
// refresh the public embed) AFTER the transaction commits but still inside the
// mutex, so a concurrent click can't observe a half-applied state.
const repo = require('../db/repo');
const mutex = require('../lib/mutex');
const logger = require('../logger');
const ticketService = require('./ticketService');
const embedService = require('./embedService');

// Open (or re-open) the private ticket channel for the current #1 buyer.
// ticketService.assign is idempotent, so this is safe for the first #1 and for
// every advance. On failure it alerts admins and returns null instead of
// throwing — the DB state is already committed, so we keep the bot consistent
// and let a human (or the buyer re-clicking "จอง") recover.
async function ensureChannel(itemId, userId) {
  try {
    const channel = await ticketService.assign(itemId, userId);
    return channel ? channel.id : null;
  } catch (err) {
    logger.error(`assign(${itemId}, ${userId}) failed: ${err.message}`);
    const item = repo.getItem(itemId);
    const slot = item ? item.slot : '?';
    await ticketService.notifyAdmins(
      `⚠️ เปิดห้องชำระเงินอัตโนมัติไม่สำเร็จ — เชกิลายที่ ${slot} ผู้ซื้อ <@${userId}> (คิวแรก). ` +
        'ตรวจสิทธิ์บอท/Category แล้วให้ผู้ซื้อกด "จอง" ซ้ำเพื่อเปิดห้องใหม่ หรือกด "ปล่อยคิว" เพื่อข้ามไปคิวถัดไป',
    );
    return null;
  }
}

// User clicks "จอง". Returns the repo result augmented with channelId when they
// hold #1 (so the caller can link them to their room).
async function reserve(itemId, userId) {
  return mutex.run(itemId, async () => {
    const res = repo.reserve(itemId, userId);
    if (res.error || res.sold) return res;

    if (res.already) {
      // Active #1 already: their channel may be missing from a prior failed
      // assign — re-open it (idempotent) so re-clicking "จอง" self-recovers.
      // If it already exists, just return its id WITHOUT re-assigning, which
      // would bulkDelete a slip they may have posted.
      if (res.active) {
        const ticket = repo.getTicket(itemId);
        const existing = await ticketService.fetchChannelSafe(ticket && ticket.channel_id);
        const channelId = existing ? existing.id : await ensureChannel(itemId, userId);
        return { ...res, channelId };
      }
      return res;
    }

    let channelId = null;
    if (res.becameFirst) channelId = await ensureChannel(itemId, userId);
    await embedService.refreshItem(itemId);
    return { ...res, channelId };
  });
}

// Read-only position check. No mutex needed.
function check(itemId, userId) {
  const item = repo.getItem(itemId);
  if (!item) return { error: 'no_item' };
  if (item.status === 'sold') return { sold: true };
  const position = repo.positionOfUser(itemId, userId);
  return { position, queueCount: repo.countQueue(itemId) };
}

// User clicks "ยกเลิกการจอง".
async function cancel(itemId, userId) {
  return mutex.run(itemId, async () => {
    const res = repo.cancel(itemId, userId);
    if (res.notInQueue) return res;
    if (res.wasActive) {
      if (res.nextUserId) await ensureChannel(itemId, res.nextUserId);
      else await lockIdleSafe(itemId);
    }
    await embedService.refreshItem(itemId);
    return res;
  });
}

// Admin clicks "ปล่อยคิว / ข้าม #1".
async function releaseAndAdvance(itemId) {
  return mutex.run(itemId, async () => {
    const res = repo.releaseAndAdvance(itemId);
    if (res.error || res.sold) return res;
    if (res.nextUserId) await ensureChannel(itemId, res.nextUserId);
    else await lockIdleSafe(itemId);
    await embedService.refreshItem(itemId);
    return res;
  });
}

// Lock the (now empty) ticket channel to admins-only, swallowing failures so a
// Discord hiccup doesn't break the committed queue state.
async function lockIdleSafe(itemId) {
  try {
    await ticketService.lockIdle(itemId);
  } catch (err) {
    logger.error(`lockIdle(${itemId}) failed: ${err.message}`);
  }
}

// Admin confirms the sale to the current buyer. shippingNote is the admin-typed
// address snapshot stored in won_orders.
async function confirmSold(itemId, buyerUserId, shippingNote) {
  return mutex.run(itemId, async () => {
    const res = repo.confirmSold(itemId, buyerUserId, shippingNote);
    if (res.error || res.already) return res;
    await embedService.refreshItem(itemId);

    // If the whole drop is now sold out, mark it done.
    const item = res.item;
    const drop = repo.getDrop(item.drop_id);
    if (drop && repo.countSoldInDrop(drop.id) >= repo.countItemsInDrop(drop.id)) {
      repo.setDropState(drop.id, 'done');
      logger.info(`Drop ${drop.id} fully sold out -> done`);
    }
    return res;
  });
}

module.exports = { reserve, check, cancel, releaseAndAdvance, confirmSold };

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

// User clicks "จอง". Returns the repo result augmented with channelId when they
// became #1.
async function reserve(itemId, userId) {
  return mutex.run(itemId, async () => {
    const res = repo.reserve(itemId, userId);
    if (res.error || res.sold || res.already) return res;

    let channelId = null;
    if (res.becameFirst) {
      try {
        const channel = await ticketService.assign(itemId, userId);
        channelId = channel ? channel.id : null;
      } catch (err) {
        logger.error(`assign on reserve(${itemId}) failed: ${err.message}`);
      }
    }
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
      try {
        if (res.nextUserId) await ticketService.assign(itemId, res.nextUserId);
        else await ticketService.lockIdle(itemId);
      } catch (err) {
        logger.error(`advance on cancel(${itemId}) failed: ${err.message}`);
      }
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
    try {
      if (res.nextUserId) await ticketService.assign(itemId, res.nextUserId);
      else await ticketService.lockIdle(itemId);
    } catch (err) {
      logger.error(`releaseAndAdvance(${itemId}) side effect failed: ${err.message}`);
    }
    await embedService.refreshItem(itemId);
    return res;
  });
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

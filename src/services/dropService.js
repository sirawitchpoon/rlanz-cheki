'use strict';

// Owns the drop schedule: arming timers, posting teasers, and revealing the
// drop. Timers are re-armed on boot from the DB (rehydrate) so a restart never
// loses a scheduled drop. A "missed" target time (already past on boot) fires
// immediately.
const repo = require('../db/repo');
const ctx = require('../lib/context');
const logger = require('../logger');
const embedService = require('./embedService');
const { nowSeconds } = require('../lib/time');

const MAX_TIMEOUT = 2 ** 31 - 1; // setTimeout 32-bit cap (~24.8 days)

/** @type {Map<number, {teaser?: any, publish?: any}>} */
const timers = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// setTimeout that survives delays beyond the 32-bit cap by re-arming in chunks.
function longTimeout(delayMs, fn) {
  if (delayMs <= MAX_TIMEOUT) return setTimeout(fn, delayMs);
  return setTimeout(() => longTimeout(delayMs - MAX_TIMEOUT, fn), MAX_TIMEOUT);
}

function clearTimers(dropId) {
  const t = timers.get(dropId);
  if (t) {
    if (t.teaser) clearTimeout(t.teaser);
    if (t.publish) clearTimeout(t.publish);
  }
  timers.delete(dropId);
}

// (Re)arm teaser + publish timers for a drop from its stored times.
function armTimers(dropId) {
  const drop = repo.getDrop(dropId);
  if (!drop) return;
  clearTimers(dropId);
  const now = nowSeconds();
  const entry = {};

  if (drop.state === 'scheduled' && drop.teaser_at) {
    if (drop.teaser_at > now) {
      entry.teaser = longTimeout((drop.teaser_at - now) * 1000, () => postTeasers(dropId));
    } else if (drop.publish_at && drop.publish_at > now) {
      // Missed the teaser window but the drop hasn't happened — tease now.
      postTeasers(dropId).catch((e) => logger.error(`postTeasers: ${e.message}`));
    }
  }

  if (drop.publish_at) {
    const delay = Math.max(0, (drop.publish_at - now) * 1000);
    entry.publish = longTimeout(delay, () => revealDrop(dropId));
  }

  timers.set(dropId, entry);
  logger.info(
    `Armed timers for drop ${dropId}: teaser_at=${drop.teaser_at || '-'} publish_at=${drop.publish_at || '-'}`,
  );
}

async function postTeasers(dropId) {
  const drop = repo.getDrop(dropId);
  if (!drop || drop.state !== 'scheduled') return; // already past the teaser phase
  const config = repo.getConfig();
  if (!config || !config.announce_channel_id) {
    logger.error('postTeasers: announce channel not configured');
    return;
  }
  const channel = await ctx.getClient().channels.fetch(config.announce_channel_id);
  const items = repo.getItemsByDrop(dropId);
  for (const item of items) {
    try {
      const msg = await channel.send(embedService.buildTeaserPayload(item, drop.publish_at));
      repo.setItemTeaserMessage(item.id, msg.id);
    } catch (err) {
      logger.error(`teaser for item ${item.id} failed: ${err.message}`);
    }
    await sleep(250); // stay clear of the channel edit/send rate bucket
  }
  repo.setDropState(dropId, 'teasing');
  logger.info(`Drop ${dropId} teasers posted`);
}

async function revealDrop(dropId) {
  const drop = repo.getDrop(dropId);
  if (!drop || drop.state === 'live' || drop.state === 'done' || drop.state === 'cancelled') {
    return;
  }
  const config = repo.getConfig();
  if (!config || !config.announce_channel_id) {
    logger.error('revealDrop: announce channel not configured');
    return;
  }
  const channel = await ctx.getClient().channels.fetch(config.announce_channel_id);
  const items = repo.getItemsByDrop(dropId);
  for (const item of items) {
    try {
      if (item.status === 'draft') repo.setItemStatus(item.id, 'available');
      const fresh = repo.getItem(item.id);
      const payload = embedService.buildSalePayload(fresh, repo.countQueue(item.id));

      let message = null;
      if (item.teaser_message_id) {
        message = await channel.messages.fetch(item.teaser_message_id).catch(() => null);
      }
      if (message) {
        await message.edit(payload);
      } else {
        message = await channel.send(payload);
      }
      repo.setItemPublicMessage(item.id, message.id);
    } catch (err) {
      logger.error(`reveal item ${item.id} failed: ${err.message}`);
    }
    await sleep(250);
  }
  repo.setDropPublished(dropId);
  logger.info(`Drop ${dropId} is now LIVE`);
}

// Cancel a setup/scheduled drop.
function cancelDrop(dropId) {
  clearTimers(dropId);
  repo.setDropState(dropId, 'cancelled');
}

// Re-arm everything from the DB on boot.
async function rehydrate() {
  const drops = repo.getDropsToRehydrate();
  for (const drop of drops) {
    if (drop.state === 'scheduled' || drop.state === 'teasing') {
      armTimers(drop.id);
    }
    // 'live' drops need no timers; their buttons are routed by custom_id.
  }
  logger.info(`Rehydrated ${drops.length} active drop(s)`);
}

module.exports = {
  armTimers,
  postTeasers,
  revealDrop,
  cancelDrop,
  rehydrate,
  clearTimers,
};

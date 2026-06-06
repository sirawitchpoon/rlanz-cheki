'use strict';

// Offline smoke test for the timer/assign-recovery hardening.
// Run:  node scripts/smoketest.js
// Needs deps installed (npm ci) but NO Discord token — all Discord side effects
// are stubbed. Uses a throwaway DB under the OS temp dir and deletes it after.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Dummy env BEFORE requiring config/db (config.js reads these at load time).
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'smoketest';
process.env.APP_ID = process.env.APP_ID || 'smoketest';
process.env.GUILD_ID = process.env.GUILD_ID || 'smoketest';
const DB = path.join(os.tmpdir(), `cheki-smoke-${process.pid}.db`);
process.env.DB_PATH = DB;

const repo = require('../src/db/repo');
const ticketService = require('../src/services/ticketService');
const embedService = require('../src/services/embedService');
const queueService = require('../src/services/queueService');

let failures = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}
function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(DB + suffix);
    } catch {
      /* ignore */
    }
  }
}

(async () => {
  // ---- Layer 1: modules load + new exports wired ----
  console.log('\nLayer 1 — load & exports');
  ok(typeof ticketService.notifyAdmins === 'function', 'ticketService.notifyAdmins exported');
  ok(
    ['reserve', 'check', 'cancel', 'releaseAndAdvance', 'confirmSold'].every(
      (k) => typeof queueService[k] === 'function',
    ),
    'queueService surface intact',
  );

  // ---- Layer 2: pure queue state machine (no Discord) ----
  console.log('\nLayer 2 — queue state machine (repo transactions)');
  const dropId = repo.createDropWithItems();
  const item = repo.getItemBySlot(dropId, 1);
  repo.setItemStatus(item.id, 'available'); // drop reveal would do this

  const a = repo.reserve(item.id, 'A');
  const b = repo.reserve(item.id, 'B');
  const c = repo.reserve(item.id, 'C');
  ok(a.becameFirst === true && a.position === 1, 'A becomes #1');
  ok(b.becameFirst === false && b.position === 2, 'B is #2');
  ok(c.position === 3, 'C is #3');
  const rel = repo.releaseAndAdvance(item.id); // skip A -> B
  ok(rel.nextUserId === 'B', 'release #1 advances to B');
  ok(repo.positionOfUser(item.id, 'C') === 2, 'C moves up to #2 (no renumber race)');
  ok(repo.positionOfUser(item.id, 'A') === null, 'skipped A is out of the queue');

  // ---- Layer 3: assign-failure recovery (Fix 3) with stubbed Discord ----
  console.log('\nLayer 3 — assign failure + recovery (Fix 3)');
  const notifyCalls = [];
  let assignBehavior = () => {
    throw new Error('simulated Discord failure');
  };
  ticketService.assign = async (itemId, userId) => assignBehavior(itemId, userId);
  ticketService.notifyAdmins = async (text) => notifyCalls.push(text);
  ticketService.fetchChannelSafe = async (id) => (id ? { id } : null);
  ticketService.lockIdle = async () => {};
  embedService.refreshItem = async () => {};

  // fresh item so this user is a clean first-#1
  const item2 = repo.getItemBySlot(dropId, 2);
  repo.setItemStatus(item2.id, 'available');

  // 3a) assign throws -> still #1, channelId null, admins alerted (not silent)
  const r1 = await queueService.reserve(item2.id, 'buyerX');
  ok(r1.becameFirst === true, '3a buyer still becomes #1 in DB');
  ok(r1.channelId === null, '3a channelId null when assign fails');
  ok(notifyCalls.length === 1, '3a admins notified exactly once');

  // 3b) buyer re-clicks "จอง" while #1 with channel missing -> recovers
  repo.setTicketChannel(item2.id, null);
  assignBehavior = () => ({ id: 'chan-recovered' });
  const r2 = await queueService.reserve(item2.id, 'buyerX');
  ok(r2.already === true && r2.active === true, '3b recognised as active #1');
  ok(r2.channelId === 'chan-recovered', '3b missing channel re-opened');

  // 3c) re-click when channel already exists -> reuse id, do NOT re-assign
  repo.setTicketChannel(item2.id, 'chan-existing');
  let reAssigned = false;
  assignBehavior = () => {
    reAssigned = true;
    return { id: 'should-not-happen' };
  };
  const r3 = await queueService.reserve(item2.id, 'buyerX');
  ok(r3.channelId === 'chan-existing', '3c existing channel reused');
  ok(reAssigned === false, '3c does NOT re-assign (would wipe a posted slip)');

  console.log(`\n${failures === 0 ? 'ALL PASSED ✅' : `${failures} CHECK(S) FAILED ❌`}`);
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKETEST ERROR:', e);
  cleanup();
  process.exit(1);
});

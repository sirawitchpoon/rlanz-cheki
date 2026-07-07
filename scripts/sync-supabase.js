'use strict';

// Backfill: push every existing order in the local SQLite DB up to Supabase.
// Run once after setting up the table + SUPABASE_* env, or any time to re-sync.
//   node scripts/sync-supabase.js
require('../src/config'); // loads .env
const repo = require('../src/db/repo');
const supabaseSync = require('../src/services/supabaseSync');

(async () => {
  if (!supabaseSync.enabled()) {
    console.error('SUPABASE_URL / SUPABASE_KEY not set in .env — nothing to do. See docs/SUPABASE.md');
    process.exit(1);
  }
  const orders = repo.getAllOrders();
  console.log(`Syncing ${orders.length} order(s) → Supabase table "${supabaseSync.TABLE}"…`);
  let ok = 0;
  for (const o of orders) {
    // eslint-disable-next-line no-await-in-loop
    if (await supabaseSync.syncOrder(o.item_id)) ok += 1;
  }
  console.log(`Done — ${ok}/${orders.length} synced.`);
  process.exit(ok === orders.length ? 0 : 1);
})();

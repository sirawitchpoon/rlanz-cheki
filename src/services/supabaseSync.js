'use strict';

// OPTIONAL cloud backup: mirror finalized orders to a Supabase (Postgres) table
// for durability + viewing, WITHOUT making the bot depend on Supabase to
// operate. SQLite stays the source of truth; this is fire-and-forget and never
// blocks or breaks a sale. Active only when SUPABASE_URL + SUPABASE_KEY are set.
// Uses Supabase's REST (PostgREST) API, so no extra dependency.
//
// See docs/SUPABASE.md for the table SQL and setup.
const repo = require('../db/repo');
const logger = require('../logger');

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_KEY || '';
const TABLE = process.env.SUPABASE_TABLE || 'cheki_orders';

function enabled() {
  return !!(URL_BASE && KEY);
}

function rowFor(o) {
  return {
    item_id: o.item_id,
    drop_id: o.drop_id,
    slot: o.slot,
    title: o.title,
    buyer_user_id: o.buyer_user_id,
    price_satang: o.price_satang,
    shipping_note: o.shipping_note,
    sold_at: o.sold_at,
    tracking_no: o.tracking_no,
    tracking_carrier: o.tracking_carrier,
    tracking_sent_at: o.tracking_sent_at,
  };
}

// Upsert one order (keyed by item_id) to Supabase. Best-effort: any failure is
// logged and swallowed so it can never affect the sale flow.
async function syncOrder(itemId) {
  if (!enabled()) return false;
  const order = repo.getOrderByItem(itemId);
  if (!order) return false;
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rowFor(order)),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return true;
  } catch (err) {
    logger.error(`supabase sync item ${itemId} failed: ${err.message}`);
    return false;
  }
}

module.exports = { enabled, syncOrder, TABLE };

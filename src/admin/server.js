'use strict';

// Embedded admin HTTP server for the web dashboard.
//
// WHY it lives INSIDE the bot process (not a separate service):
//   - "read" actions just query SQLite (repo), but
//   - "write" actions (reveal / cancel / cleanup / advance a queue) must use the
//     live Discord client (ctx.getClient()) AND go through the same services so
//     the per-item mutex + transaction guarantees still hold. A separate process
//     would have neither the client nor the in-memory mutex.
//
// SECURITY MODEL (see docs/DASHBOARD.md):
//   - Binds to 127.0.0.1 by default, so ONLY a same-host reverse proxy
//     (cloudflared) can reach it — never the public internet directly.
//   - Cloudflare Access sits in front and does the real auth (email allow-list).
//     After a user passes Access, Cloudflare injects the verified header
//     `Cf-Access-Authenticated-User-Email`; we allow-list it via ADMIN_ALLOWED_EMAILS.
//   - For local testing without Cloudflare, set ADMIN_TOKEN and send it as the
//     `X-Admin-Token` header (or `?token=` query).
//
// It is OPT-IN: index.js only starts it when ADMIN_PORT is set, and a missing
// `express` dependency degrades to a logged warning instead of crashing the bot.

const fs = require('fs');
const path = require('path');
const config = require('../config');
const repo = require('../db/repo');
const ctx = require('../lib/context');
const logger = require('../logger');
const dropService = require('../services/dropService');
const ticketService = require('../services/ticketService');
const queueService = require('../services/queueService');
const embedService = require('../services/embedService');
const { formatBangkok } = require('../lib/time');

const STATUS_LABEL = {
  draft: 'ยังไม่เปิดขาย',
  available: 'ว่าง (เปิดจอง)',
  reserved: 'กำลังชำระเงิน',
  sold: 'ขายแล้ว',
};

// Resolve a Discord channel id to its #name using the bot's cache (Guilds intent
// keeps the guild's channels cached). Returns null if the bot isn't connected
// yet or the channel isn't known — callers fall back to showing the raw id.
function channelName(id) {
  if (!id || !ctx.isReady()) return null;
  try {
    const ch = ctx.getClient().channels.cache.get(id);
    return ch && ch.name ? ch.name : null;
  } catch {
    return null;
  }
}

// Shape a single item + its ticket (channel) into a dashboard-friendly row.
function itemView(item) {
  const ticket = repo.getTicket(item.id);
  const active = repo.getActiveEntry(item.id);
  const order = repo.getOrderByItem(item.id);
  return {
    id: item.id,
    slot: item.slot,
    title: item.title,
    description: item.description,
    hasImage: !!item.image_path,
    status: item.status,
    statusLabel: STATUS_LABEL[item.status] || item.status,
    price: embedService.formatBaht(item.price_satang),
    priceSatang: item.price_satang,
    queueCount: repo.countQueue(item.id),
    currentBuyerId: active ? active.user_id : null,
    // "R1 อยู่ที่ #pay-slot-1" — the live channel this design's ticket occupies.
    channelId: ticket ? ticket.channel_id : null,
    channelName: channelName(ticket ? ticket.channel_id : null),
    ticketState: ticket ? ticket.state : null,
    buyerUserId: item.buyer_user_id, // final buyer once sold
    trackingNo: order ? order.tracking_no : null,
    trackingSentAt: order ? order.tracking_sent_at : null,
  };
}

function dropView(drop) {
  if (!drop) return null;
  return {
    id: drop.id,
    name: drop.name || null,
    displayName: drop.name || `ดรอป #${drop.id}`,
    state: drop.state,
    publishAt: drop.publish_at,
    publishAtText: drop.publish_at ? formatBangkok(drop.publish_at) : null,
    teaserAt: drop.teaser_at,
    announceChannelId: drop.announce_channel_id || null,
    announceChannelName: channelName(drop.announce_channel_id),
    items: repo.getItemsByDrop(drop.id).map(itemView),
  };
}

// Build the Express app. Kept in its own function so it can be unit-tested
// without binding a port.
function buildApp(express) {
  const app = express();
  app.use(express.json({ limit: '16mb' })); // room for base64 image uploads

  const allowedEmails = (process.env.ADMIN_ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const token = process.env.ADMIN_TOKEN || null;

  const parseCookies = (req) => {
    const raw = req.headers.cookie;
    if (!raw) return {};
    return Object.fromEntries(
      raw.split(';').map((c) => {
        const i = c.indexOf('=');
        return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
      }),
    );
  };

  // --- Auth gate -----------------------------------------------------------
  // Order: Cloudflare Access email (production w/ domain) → shared token via
  // header / ?token= / session cookie. When the token arrives in the query the
  // first time, we stash it in an HttpOnly cookie so it doesn't have to live in
  // the URL afterwards (important over a public Quick Tunnel URL).
  app.use((req, res, next) => {
    const email = (req.get('Cf-Access-Authenticated-User-Email') || '').toLowerCase();
    if (email && (allowedEmails.length === 0 || allowedEmails.includes(email))) {
      req.adminEmail = email;
      return next();
    }
    if (token) {
      const supplied = req.get('X-Admin-Token') || req.query.token || parseCookies(req).admin_session;
      if (supplied === token) {
        if (req.query.token) {
          res.setHeader(
            'Set-Cookie',
            `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
          );
        }
        req.adminEmail = 'token';
        return next();
      }
    }
    return res.status(401).json({ error: 'unauthorized' });
  });

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      logger.error(`admin ${req.method} ${req.path} failed: ${err.stack || err.message}`);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  };

  // Write actions touch Discord (create/repermission channels, edit embeds), so
  // they need the live client that ClientReady sets. Until then, fail clearly
  // instead of throwing "Discord client not initialised yet". Reads skip this.
  const requireReady = (req, res, next) => {
    if (!ctx.isReady()) {
      return res.status(503).json({ error: 'bot_not_connected', message: 'บอทยังไม่เชื่อมต่อ Discord — ลองใหม่อีกครั้ง' });
    }
    return next();
  };

  // --- Reads ---------------------------------------------------------------
  app.get('/api/health', (req, res) => res.json({ ok: true, as: req.adminEmail }));

  // Current (in-progress) drop + the channel each design sits in.
  app.get('/api/status', wrap((req, res) => {
    const drop = repo.getCurrentDrop() || repo.getLatestDrop();
    res.json({ config: safeConfig(), drop: dropView(drop) });
  }));

  // Lightweight list for the sidebar (newest first).
  app.get('/api/drops', wrap((req, res) => {
    const drops = repo.getAllDrops().map((d) => ({
      id: d.id,
      displayName: d.name || `ดรอป #${d.id}`,
      state: d.state,
    }));
    res.json({ drops });
  }));

  // Create a new drop (optionally named, with N blank slots). Pure DB — replaces
  // needing /cheki init in Discord.
  app.post('/api/drops', wrap((req, res) => {
    const body = req.body || {};
    const id = repo.createDropWithItems(body.count ? Number(body.count) : 5);
    if (typeof body.name === 'string' && body.name.trim()) repo.setDropName(id, body.name.trim());
    logger.info(`admin(${req.adminEmail}) created drop ${id}`);
    res.json({ ok: true, drop: dropView(repo.getDrop(id)) });
  }));

  app.get('/api/drops/:id', wrap((req, res) => {
    const drop = repo.getDrop(Number(req.params.id));
    if (!drop) return res.status(404).json({ error: 'no_drop' });
    res.json({ drop: dropView(drop), orders: repo.getOrdersByDrop(drop.id) });
  }));

  // Rename a drop and/or set the text channel it posts to (both pure DB, no
  // Discord call, so this works even before the bot finishes connecting).
  app.patch('/api/drops/:id', wrap((req, res) => {
    const id = Number(req.params.id);
    if (!repo.getDrop(id)) return res.status(404).json({ error: 'no_drop' });
    const body = req.body || {};
    if (typeof body.name === 'string') repo.setDropName(id, body.name.trim() || null);
    if (typeof body.announceChannelId === 'string') {
      repo.setDropAnnounceChannel(id, body.announceChannelId.trim() || null);
    }
    res.json({ ok: true, drop: dropView(repo.getDrop(id)) });
  }));

  // --- Writes (delegate to services so the mutex/transaction still apply) ---

  // Force the drop open right now (same code the publish timer runs).
  app.post('/api/drops/:id/reveal', requireReady, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!repo.getDrop(id)) return res.status(404).json({ error: 'no_drop' });
    await dropService.revealDrop(id);
    logger.info(`admin(${req.adminEmail}) revealed drop ${id}`);
    res.json({ ok: true, drop: dropView(repo.getDrop(id)) });
  }));

  // Cancel a setup/scheduled drop (clears its timers).
  app.post('/api/drops/:id/cancel', requireReady, wrap((req, res) => {
    const id = Number(req.params.id);
    if (!repo.getDrop(id)) return res.status(404).json({ error: 'no_drop' });
    dropService.cancelDrop(id);
    logger.info(`admin(${req.adminEmail}) cancelled drop ${id}`);
    res.json({ ok: true, drop: dropView(repo.getDrop(id)) });
  }));

  // Delete all private ticket channels of a drop (order snapshots are kept).
  app.post('/api/drops/:id/cleanup', requireReady, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!repo.getDrop(id)) return res.status(404).json({ error: 'no_drop' });
    const deleted = await ticketService.cleanupAll(id);
    logger.info(`admin(${req.adminEmail}) cleaned up drop ${id}: ${deleted} channel(s)`);
    res.json({ ok: true, deleted });
  }));

  // Edit an item's title / description / price (baht). Pure DB — replaces the
  // setup-panel edit modal. Refreshes the public embed if the drop is live.
  app.patch('/api/items/:id', wrap((req, res) => {
    const id = Number(req.params.id);
    const item = repo.getItem(id);
    if (!item) return res.status(404).json({ error: 'no_item' });
    const b = req.body || {};
    let priceSatang = item.price_satang;
    if (b.priceBaht != null && String(b.priceBaht).trim() !== '') {
      const n = Number(b.priceBaht);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'bad_price' });
      priceSatang = Math.round(n * 100);
    }
    repo.updateItemDetails(id, {
      title: b.title != null ? String(b.title).trim() : item.title,
      description: b.description != null ? String(b.description).trim() || null : item.description,
      priceSatang,
    });
    if (ctx.isReady()) embedService.refreshItem(id).catch(() => {});
    res.json({ ok: true, item: itemView(repo.getItem(id)) });
  }));

  const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
  // Upload/replace an item image (base64 JSON, so no multipart dependency).
  app.post('/api/items/:id/image', wrap((req, res) => {
    const id = Number(req.params.id);
    const item = repo.getItem(id);
    if (!item) return res.status(404).json({ error: 'no_item' });
    const { filename, dataBase64 } = req.body || {};
    if (!dataBase64) return res.status(400).json({ error: 'no_data' });
    const ext = (path.extname(filename || '') || '.png').toLowerCase();
    if (!IMG_EXT.has(ext)) return res.status(400).json({ error: 'bad_type' });
    const buf = Buffer.from(String(dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buf.length) return res.status(400).json({ error: 'empty' });
    const dir = path.join(config.imagesDir, String(item.drop_id));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${item.slot}${ext}`);
    fs.writeFileSync(dest, buf);
    repo.setItemImage(id, dest, filename || `${item.slot}${ext}`);
    if (ctx.isReady()) embedService.refreshItem(id).catch(() => {});
    logger.info(`admin(${req.adminEmail}) set image for item ${id}`);
    res.json({ ok: true, item: itemView(repo.getItem(id)) });
  }));

  // Serve an item's image file (for the dashboard's tracking-embed preview).
  // Behind the same auth middleware; the browser sends the session cookie.
  app.get('/api/items/:id/image', wrap((req, res) => {
    const item = repo.getItem(Number(req.params.id));
    if (!item || !item.image_path || !fs.existsSync(item.image_path)) return res.status(404).end();
    return res.sendFile(item.image_path);
  }));

  // Skip the current #1 of an item and advance the queue (admin "ปล่อยคิว").
  app.post('/api/items/:id/release', requireReady, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!repo.getItem(id)) return res.status(404).json({ error: 'no_item' });
    const result = await queueService.releaseAndAdvance(id);
    logger.info(`admin(${req.adminEmail}) released item ${id}`);
    res.json({ ok: true, result, item: itemView(repo.getItem(id)) });
  }));

  // Post a tracking number into the buyer's private channel (after shipping).
  app.post('/api/items/:id/track', requireReady, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!repo.getItem(id)) return res.status(404).json({ error: 'no_item' });
    const trackingNo = (req.body && req.body.trackingNo) || '';
    if (!String(trackingNo).trim()) return res.status(400).json({ error: 'no_tracking' });
    const result = await ticketService.notifyTracking(id, trackingNo);
    logger.info(`admin(${req.adminEmail}) sent tracking for item ${id}`);
    res.json({ ok: true, result, item: itemView(repo.getItem(id)) });
  }));

  // --- Static dashboard ----------------------------------------------------
  app.use(express.static(path.join(__dirname, 'public')));

  return app;
}

// Only expose non-secret config fields to the browser.
function safeConfig() {
  const c = repo.getConfig();
  if (!c) return null;
  return {
    guildId: c.guild_id,
    announceChannelId: c.announce_channel_id,
    ticketCategoryId: c.ticket_category_id,
    paymentMode: c.qr_image_path ? 'static-image' : c.promptpay_id ? 'generated' : 'none',
  };
}

// Called from index.js after ClientReady. No-op (with a warning) if disabled or
// if express isn't installed, so it can never take the bot down.
function start() {
  const port = Number(process.env.ADMIN_PORT || 0);
  if (!port) return null; // dashboard disabled
  const host = process.env.ADMIN_HOST || '127.0.0.1';

  let express;
  try {
    express = require('express');
  } catch {
    logger.warn('ADMIN_PORT is set but `express` is not installed — run `npm install`. Dashboard disabled.');
    return null;
  }

  const app = buildApp(express);
  const server = app.listen(port, host, () => {
    logger.info(`Admin dashboard listening on http://${host}:${port} (front it with Cloudflare Access)`);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      logger.warn(`ADMIN_HOST=${host} is NOT localhost — make sure a firewall/Access protects it.`);
    }
  });
  server.on('error', (err) => logger.error(`admin server error: ${err.message}`));
  return server;
}

module.exports = { start, buildApp, dropView, itemView };

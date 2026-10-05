# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-guild Discord bot (discord.js v14, CommonJS, Node ≥18) that sells unique physical "cheki" prints in **drops**: each drop has N designs (1–20, default 5), a per-design waitlist queue, manual PromptPay slip verification, and private per-design checkout ("cashier") channels. Zero recurring cost — no payment gateway; payment is a PromptPay QR (uploaded static image, or generated with the amount embedded) + an admin eyeballing the slip.

The **web admin dashboard** (`src/admin/`) is the primary admin surface and the owner does everything there: create/rename drops, edit designs + upload images, settings (payment QR, channels, admin role), schedule or open a drop, pre-post locked cards, view queues, send tracking numbers. The `/cheki` slash command + Discord setup panel still work but are unused. `README.md` is the original Discord-only walkthrough; ops guides live in `docs/`. UI copy is Thai.

## How it runs in production

On the **owner's own Mac, only while a drop is active** — no VPS, no paid domain:

```bash
./scripts/start-tailscale.sh   # bot + Tailscale Funnel → stable https://<machine>.<tailnet>.ts.net/?token=<ADMIN_TOKEN>  (docs/TAILSCALE.md)
./scripts/start-tunnel.sh      # alternative: Cloudflare Quick Tunnel (random URL), or Named Tunnel when CF_TUNNEL_TOKEN is set
```

- Scheduled teaser/publish timers only fire while that process runs; a missed time fires immediately on the next boot.
- Stopping the process after a drop is safe — state is in SQLite (`data/cheki.db`) and orders are mirrored to Supabase.
- Deploy = `git pull` + restart the script. Changes to `src/admin/public/*` only need a browser refresh.
- Docker/PM2 (`docs/DEPLOY.md`) still work but are not used.

## Commands

```bash
npm install                    # better-sqlite3 builds a native module
npm start                      # node src/index.js (dashboard starts only if ADMIN_PORT is set)
node scripts/smoketest.js      # offline queue/assign-recovery checks — run after touching repo/queue/ticket code
node scripts/sync-supabase.js  # backfill every won_orders row to Supabase
node scripts/seed-drop.js      # TEMPLATE to reconstruct a past drop — fill IDs locally, never commit them
npm run deploy                 # register /cheki (only if the Discord panel is used; re-run after editing src/commands/cheki.js)
```

There is no linter, build step or test runner beyond `smoketest.js`. **Ad-hoc test recipe** (used for every feature so far):

- Run with `DISCORD_TOKEN=x APP_ID=x GUILD_ID=x DB_PATH=<throwaway> SUPABASE_URL= SUPABASE_KEY= node <script>`. Inline env wins over `.env` (dotenv never overrides an already-set var, even an empty one) — so the empty `SUPABASE_*` disables sync; leave them out and tests write to the **real** Supabase project.
- Exercise the API without Discord: `require('./src/admin/server').buildApp(require('express')).listen(0, '127.0.0.1')`; fake Discord with `ctx.setClient({ user, channels: { fetch }, guilds: { cache: { get } } })`.
- Scripts kept outside the repo (scratchpad) must `require()` repo modules **and `express`** by absolute path.
- `config.imagesDir` is always `<repo>/data/images` regardless of `DB_PATH` — image-upload tests write there; clean up after.
- Anything reaching `dropService.armTimers` leaves a live timer → end the script with `process.exit(0)`.
- Inspect real data read-only: `require('better-sqlite3')('./data/cheki.db', { readonly: true })`.

## Critical gotchas (these will bite you)

- **`data/` and `.env` hold real customer data and secrets** (both gitignored). Before every commit, scan the staged diff for customer Discord IDs/addresses; `scripts/seed-drop.js` must stay a placeholder template.
- **`reserve()` only makes someone #1 when `item.status === 'available'`.** Items start as `draft`; the reveal flips them to `available`. Reserving a draft item inserts a queue entry but never assigns the cashier channel.
- **Pre-posted locked cards and the spoiler teaser share `items.teaser_message_id`.** `postTeasers` edits that message in place, so scheduling a teaser lead after pre-posting cards turns them into blurred teasers — use lead 0 with pre-posted cards. `revealDrop` always edits whatever that message is into the live card.
- **A new column in `supabaseSync.rowFor` needs `alter table cheki_orders add column …` on Supabase first**, or every sync fails with PGRST204 (sales keep working, the backup silently stops). Update the SQL in `docs/SUPABASE.md` too.
- **`repo.upsertConfig` merges with `??`** — passing `null` keeps the old value; config fields cannot be cleared through it.
- **Cashier channel names are fixed at creation** (`<drop-slug>-slot-N` from the drop name before " - "); renaming the drop later doesn't rename existing channels.
- **The admin server starts before Discord login** (so the dashboard works even with a bad token). Read routes work immediately; routes that touch Discord sit behind `requireReady` and return 503 until `ClientReady`.
- **Embeds re-attach the image file on every edit** (`attachments: []` + new `files`). Deliberate — old Discord CDN URLs expire. Don't "optimize" it into a stored URL.
- **`MessageFlags.Ephemeral`** is the flag style used. Every interaction handler `deferReply`/`deferUpdate`/`showModal`s first to beat the 3-second ack window.
- Docker bakes `src/` into the image — rebuild (`docker compose up -d --build`) *before* `deploy-commands` if you ever use Docker.

## Architecture (the parts that span files)

**Strict layering — respect it:**
- `src/db/repo.js` is the **only** place SQL lives. The atomic queue mutations (`reserve`, `cancel`, `releaseAndAdvance`, `confirmSold`, `createDropWithItems`) are `db.transaction(...)` functions — pure, synchronous, no Discord calls inside.
- `src/services/*` hold business logic and the Discord-side side effects.
- `src/interactions/*` (Discord) and `src/admin/server.js` (HTTP) are thin layers that parse and delegate.

**Concurrency model (correctness core):** `queueService` wraps each repo transaction in a **per-item async mutex** (`lib/mutex.js`) AND the repo work is a SQLite **transaction**. The mutex protects the read-decide-act window that spans `await`s; the transaction protects the multi-statement write. Side effects run *after* commit but *inside* the mutex. `UNIQUE(item_id, user_id)` on `queue_entries` makes a double-#1 impossible. Any new write path must go through these services (the dashboard does).

**Queue positions are derived, never stored** — position = count of `waiting`/`active` entries with `seq <= mine` (`seq` from the single-row `seq_counter`). Cancels set `state='left'`; no renumbering.

**Buttons survive restarts** because routing is by `custom_id`. `src/interactions/ids.js` is the single source of truth for the format; never build or parse one elsewhere.

**Drop lifecycle** (`drops.state`): `setup → scheduled → teasing → live → done|cancelled`. `dropService.armTimers` sets the teaser + publish timers and is re-run from the DB on boot (`rehydrate`). `revealDrop` edits each item's `teaser_message_id` post (spoiler teaser *or* locked preview card) into the live card, else sends a new one.

**Per-drop announce channel:** `drops.announce_channel_id` overrides `config.announce_channel_id`. Always resolve through `repo.announceChannelFor(drop)` (dropService and `embedService.refreshItem` do).

**Cashier channels: create-on-demand, then REUSE.** `ticketService.assign` creates the channel once (name from `channelNameFor(drop, slot)`), and on every queue advance re-permissions the *same* channel to the new buyer + `bulkDelete`s history + reposts the QR/control message. Channels are deleted only via cleanup (`ticketService.cleanupAll`, the dashboard's "ลบห้องทั้งหมด").

**`embedService.refreshItem(itemId)` is the single chokepoint** for updating a live public card. `buildSalePayload(item, queue, { locked, publishAt })` renders it; `locked` disables every button and adds a `🔒 เปิดจอง <t:…:R>` line (used by `dropService.postPreviewCards`).

**Admin dashboard** (`src/admin/server.js` + one self-contained `src/admin/public/index.html`, vanilla JS, light/dark tokens, mobile drawer):
- Runs **in-process** with the bot so writes reuse the live client and the services above. Opt-in via `ADMIN_PORT`; binds `ADMIN_HOST` (127.0.0.1); a missing `express` only logs a warning.
- Auth order: Cloudflare Access email header (`ADMIN_ALLOWED_EMAILS`) → `ADMIN_TOKEN` via `X-Admin-Token`, `?token=`, or the `admin_session` HttpOnly cookie (set on the first `?token=` hit; the page then strips it from the URL).
- `dropView` / `itemView` shape everything the UI shows and resolve ids → names through the bot cache (`channelName`, `roleName`, cached `resolveUserName`), falling back to raw ids.
- Pure-DB writes (rename, item edit/image, settings, schedule, recipient) work without Discord; Discord-touching ones use `requireReady`. Route list: `docs/DASHBOARD.md` — keep it in sync.

**Tracking notices:** `ticketService.notifyTracking(itemId, number, carrier)` posts an embed into the buyer's cashier channel — carrier colour + Link button from `src/lib/carriers.js`, recipient field, cheki thumbnail — and records `won_orders.tracking_no / tracking_carrier / tracking_sent_at`.

**Supabase mirror:** `services/supabaseSync.js` — env-gated (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_TABLE`), fire-and-forget PostgREST upsert of one `won_orders` row keyed by `item_id`, called after `confirmSold`, `notifyTracking` and recipient saves. SQLite stays the source of truth.

**Migrations:** no framework. `db.js` runs `schema.sql` (`CREATE … IF NOT EXISTS`), then additive `ensureColumn(table, col, type)` calls — every column added after the original schema lives only there. Add new columns the same way.

**Client access:** `lib/context.js` holds the live client; timer/HTTP code uses `ctx.getClient()` / `ctx.getGuild()`, and `ctx.isReady()` to check before touching Discord.

## Conventions

- **Money is integer satang** (THB × 100) everywhere in the DB; convert only at display (`formatBaht`) and QR generation.
- **Time:** admin input is `YYYY-MM-DD HH:mm` (or `T`-separated, e.g. from `datetime-local`) interpreted as **Asia/Bangkok (fixed UTC+7)** by `lib/time.js#parseBangkok`. Use `<t:unix:R>` (`discordTime`) for countdowns — they don't render in embed footers.
- **Config is split:** `.env` holds secrets/ids and `ADMIN_*`, `SUPABASE_*`, `CF_TUNNEL_*`; operational config (payment QR/promptpay, announce channel, ticket category, admin role) lives in the DB `config` row, edited in the dashboard's ⚙️ settings (or `/cheki config`).
- **Admin gating in Discord** is `interactions/guards.js#isAdmin` (guild owner, Administrator/Manage Server, or the configured `admin_role_id`). Without `admin_role_id` set, admins get no ping when a buyer posts a slip and non-admin staff can't see cashier channels.
- **Sale confirmation still happens in Discord** — the ✅ button on the cashier channel's QR message → shipping modal → `confirmSold`. The dashboard has no confirm action. Slips/addresses are plain messages in the cashier channel.
- Required bot permissions: Manage Channels + Manage Roles, Send Messages, Embed Links, Attach Files, Read Message History, Manage Messages. Intent: **GuildMembers** (privileged).
- Git: work on a feature branch (`feature/dashboard-and-schema-v2` so far), one commit + PR per finished feature.

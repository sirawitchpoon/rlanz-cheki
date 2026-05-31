# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-guild Discord bot (discord.js v14, CommonJS, Node ≥18) that sells 5 unique physical "cheki" prints via a scheduled drop: a waitlist queue, manual PromptPay slip verification, and private per-design checkout channels. Zero recurring cost — no payment gateway; payment is a generated PromptPay QR + an admin eyeballing the slip. See `README.md` for the product/admin walkthrough.

## Commands

```bash
npm install                 # installs deps (better-sqlite3 builds a native module)
npm run deploy              # register the /cheki guild command (run once, and after ANY change to the command definition)
npm start                   # run the bot (node src/index.js)

# Docker (production / VPS)
docker compose up -d --build                              # build + run (restart: unless-stopped)
docker compose run --rm bot node src/deploy-commands.js   # register commands
docker compose logs -f
```

There is **no test runner, linter, or build step**. To smoke-test logic without a Discord token, set dummy env (`DISCORD_TOKEN`, `APP_ID`, `GUILD_ID`) + a throwaway `DB_PATH`, then `require('./src/db/repo')` and exercise the transaction functions / `qrService.generate` / `embedService.buildSalePayload` directly with `node -e`. Inspect data with: `docker compose exec bot node -e "console.table(require('better-sqlite3')('./data/cheki.db').prepare('SELECT * FROM won_orders').all())"`.

## Critical gotchas (these will bite you)

- **Docker bakes `src/` into the image** (`COPY src ./src`, not a mount). Code changes require `docker compose up -d --build` *before* `deploy-commands` — otherwise the running container and the deploy use the old code.
- **`deploy-commands` must be re-run after editing the command definition** in `src/commands/cheki.js`. Commands are **guild-scoped** (instant updates); global registration is not used.
- **`reserve()` only makes someone #1 when `item.status === 'available'`.** Items start as `draft`; the drop reveal flips them to `available`. Reserving a draft item inserts a queue entry but never assigns the ticket channel. (Caught us in testing.)
- **Embeds re-attach the image file on every edit** (`embedService` sets `attachments: []` + new `files`). This is deliberate — referencing an old Discord CDN URL would break when its signed URL expires. Don't "optimize" it into a stored URL.
- **`MessageFlags.Ephemeral`** is the flag style used (not the deprecated `{ ephemeral: true }`). Every interaction handler `deferReply`/`deferUpdate`/`showModal`s as its first action to beat the 3-second ack window.

## Architecture (the parts that span files)

**Strict layering — respect it:**
- `src/db/repo.js` is the **only** place SQL lives. All other code calls its functions. The atomic queue mutations (`reserve`, `cancel`, `releaseAndAdvance`, `confirmSold`) are exported as `db.transaction(...)` functions — pure, synchronous DB work, no Discord calls inside.
- `src/services/*` hold business logic and the Discord-side side effects.
- `src/interactions/*` are thin handlers that parse and delegate.

**Concurrency model (correctness core):** `queueService` wraps each repo transaction in a **per-item async mutex** (`lib/mutex.js`) AND the repo work is a SQLite **transaction**. The mutex protects the read-decide-act window that spans `await`s (DB read → Discord API calls); the transaction protects the multi-statement DB write. Side effects (create/repermission channel, refresh embed) run *after* the transaction commits but *still inside the mutex*. `UNIQUE(item_id, user_id)` on `queue_entries` is the structural backstop that makes a double-#1 impossible.

**Queue positions are derived, never stored.** Each entry has a monotonic `seq` (from the single-row `seq_counter`). Position = count of `waiting`/`active` entries with `seq <= mine`. Cancels just set `state='left'` — no renumbering, so no renumber race.

**Buttons survive restarts** because routing is by `custom_id`, not stored listeners. `src/interactions/ids.js` is the single source of truth for custom_id format (`item:{id}:reserve`, `tk:{id}:confirm`, `setup:edit:{slot}`, `m:item:{id}`, …); `router.js` parses and dispatches. Never construct or parse a custom_id outside `ids.js`.

**Drop lifecycle** (`drops.state`): `setup → scheduled → teasing → live → done|cancelled`. `dropService` arms two `setTimeout`s (teaser, publish) and **rehydrates them from the DB on boot** (`index.js` ClientReady → `dropService.rehydrate()`); a target time already in the past fires immediately. Reveal *edits* the teaser messages into live sale messages (SPOILER_ attachment → real image + buttons).

**Ticket channels: create-on-demand, then REUSE.** `ticketService.assign` is idempotent — it creates the private channel the first time and, on every queue advance, re-permissions the *same* channel to the new buyer (`permissionOverwrites.set`) + `bulkDelete`s history + reposts the QR/control message. This avoids the channel-create quota and keeps the prior buyer's slip/address private. Channels are deleted **only** via the admin Cleanup button (`ticketService.cleanupAll`).

**`embedService.refreshItem(itemId)` is the single chokepoint** for updating a public sale message (status emoji/color + queue count). Call it after every state change; never edit the public message elsewhere.

**Client access:** `lib/context.js` holds the live client (set in `index.js`). Timer-driven code (drops, advances) uses `ctx.getClient()`/`ctx.getGuild()` since there's no interaction in hand.

## Conventions

- **Money is integer satang** (THB × 100) everywhere in the DB; convert only at display (`embedService.formatBaht`) and QR generation (`qrService` divides by 100).
- **Time:** admin input is `YYYY-MM-DD HH:mm` interpreted as **Asia/Bangkok (fixed UTC+7, no DST)** — `lib/time.js` computes the offset explicitly, independent of the server's TZ. Use `<t:unix:R>` (`discordTime`) for client-rendered countdowns.
- **Config is split:** secrets/IDs (`DISCORD_TOKEN`, `APP_ID`, `GUILD_ID`) come from `.env` via `config.js`; operational config (admin role, announce channel, setup channel, ticket category, promptpay id) lives in the DB `config` table, set at runtime via `/cheki config`.
- **Admin gating** is `interactions/guards.js#isAdmin` (guild owner OR the configured `admin_role_id`). `/cheki` is also hidden from non-admins via `setDefaultMemberPermissions(ManageGuild)`, but that is visibility only — `isAdmin` is the real gate and every admin button/modal re-checks it.
- Slip/address are collected as **plain messages** in the ticket channel (modals can't take files); the bot only flips ticket state + pings admins. The shipping address is snapshotted into `won_orders` via the confirm modal so cleanup never loses it.
- Required bot permissions: **Manage Channels + Manage Roles** (Manage Roles is needed to set channel permission overwrites), Send Messages, Embed Links, Attach Files, Read Message History, Manage Messages. Intent: **GuildMembers** (privileged) for `guildMemberRemove` auto-advance.

'use strict';

// Bot entrypoint: builds the client, wires events, rehydrates scheduled drops
// on boot, and logs in.
const { Client, GatewayIntentBits, Events, Options } = require('discord.js');
const config = require('./config');
const logger = require('./logger');
const ctx = require('./lib/context');
const repo = require('./db/repo');
const router = require('./interactions/router');
const dropService = require('./services/dropService');
const queueService = require('./services/queueService');
const adminServer = require('./admin/server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // channels, roles, channel create + overwrites
    GatewayIntentBits.GuildMembers, // guildMemberRemove (privileged: enable in Dev Portal)
    GatewayIntentBits.GuildMessages, // detect buyer messages in ticket channels
  ],
  // Keep resident memory small and predictable: this bot reads everything from
  // gateway events, never from cache, so cache only what discord.js needs to
  // operate. (Guild/Channel/Role caches are required by the library — limiting
  // them is unsupported and would break, so they stay at the defaults.)
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0, // MessageCreate uses the event object, not the cache
    PresenceManager: 0, // no GuildPresences intent — nothing to cache
    ReactionManager: 0, // reactions unused
    GuildMemberManager: {
      maxSize: 200, // LimitedCollection evicts the oldest beyond this, so it self-bounds
      keepOverLimit: (member) => member.id === member.client.user.id, // always keep the bot
    },
  }),
});

client.once(Events.ClientReady, async (c) => {
  ctx.setClient(c);
  logger.info(`Logged in as ${c.user.tag} (${c.user.id})`);
  try {
    await dropService.rehydrate();
  } catch (err) {
    logger.error(`rehydrate failed: ${err.stack || err.message}`);
  }
});

// Route every interaction (commands, buttons, modals) through the dispatcher.
client.on(Events.InteractionCreate, (interaction) => {
  router.route(interaction);
});

// Detect when the buyer posts in their private channel; flip the ticket to
// "awaiting_review" and ping the admins once so they know to check.
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guildId) return;
    const ticket = repo.getTicketByChannel(message.channelId);
    if (!ticket) return;
    if (ticket.state === 'awaiting_payment' && message.author.id === ticket.buyer_user_id) {
      repo.setTicketState(ticket.item_id, 'awaiting_review');
      const cfg = repo.getConfig();
      const mention = cfg && cfg.admin_role_id ? `<@&${cfg.admin_role_id}>` : 'แอดมิน';
      await message.channel
        .send({
          content: `${mention} ผู้ซื้อส่งข้อมูลแล้ว — กรุณาตรวจสอบสลิป/ที่อยู่ แล้วกด ✅ ยืนยันการขาย หรือ ⏭️ ปล่อยคิว`,
          allowedMentions: { roles: cfg && cfg.admin_role_id ? [cfg.admin_role_id] : [] },
        })
        .catch(() => {});
    }
  } catch (err) {
    logger.error(`messageCreate handler error: ${err.message}`);
  }
});

// If the current #1 buyer leaves the server, auto-advance their items.
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const actives = repo.activeEntriesForUser(member.id);
    for (const entry of actives) {
      logger.info(`User ${member.id} left while #1 on item ${entry.item_id}; advancing`);
      await queueService.releaseAndAdvance(entry.item_id);
    }
  } catch (err) {
    logger.error(`guildMemberRemove handler error: ${err.message}`);
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
});
process.on('uncaughtException', (err) => {
  logger.error(`uncaughtException: ${err.stack || err.message}`);
});

// Start the opt-in web dashboard BEFORE login (only if ADMIN_PORT is set). Its
// read endpoints work straight off SQLite, so the dashboard is reachable even
// while Discord is connecting or if the token is bad; write actions return 503
// until ClientReady sets the live client. Runs in-process so writes reuse the
// per-item mutex once connected.
try {
  adminServer.start();
} catch (err) {
  logger.error(`admin server failed to start: ${err.stack || err.message}`);
}

client.login(config.token);

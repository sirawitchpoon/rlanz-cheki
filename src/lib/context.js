'use strict';

// Holds a reference to the live discord.js Client so timer-driven code (drop
// reveals, queue advances) can reach Discord without an interaction in hand.
// Set once at boot in index.js.
const config = require('../config');

let client = null;

function setClient(c) {
  client = c;
}

function getClient() {
  if (!client) throw new Error('Discord client not initialised yet');
  return client;
}

// True once the client is set (ClientReady has fired). Lets code that can run
// before Discord is connected — e.g. the admin dashboard's read endpoints —
// check readiness instead of catching a throw from getClient().
function isReady() {
  return client !== null;
}

// Returns the single guild this bot serves, from cache. Throws if not cached
// (which would mean the bot isn't in the guild or hasn't finished READY).
function getGuild() {
  const guild = getClient().guilds.cache.get(config.guildId);
  if (!guild) throw new Error(`Guild ${config.guildId} not found in cache`);
  return guild;
}

module.exports = { setClient, getClient, getGuild, isReady };

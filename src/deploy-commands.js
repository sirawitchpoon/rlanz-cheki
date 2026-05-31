'use strict';

// One-off script to register the /cheki command in the configured guild.
// Guild-scoped commands update INSTANTLY (global ones take ~1h). Run with:
//   npm run deploy
// Re-run whenever the command definition changes.
const { REST, Routes } = require('discord.js');
const config = require('./config');
const cheki = require('./commands/cheki');
const logger = require('./logger');

async function main() {
  const body = [cheki.data.toJSON()];
  const rest = new REST({ version: '10' }).setToken(config.token);
  logger.info(`Registering ${body.length} command(s) to guild ${config.guildId}...`);
  await rest.put(Routes.applicationGuildCommands(config.appId, config.guildId), { body });
  logger.info('Slash commands registered ✅');
}

main().catch((err) => {
  logger.error(`Command registration failed: ${err.stack || err.message}`);
  process.exit(1);
});

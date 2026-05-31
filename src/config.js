'use strict';

// Loads and validates environment configuration. Fails fast if a required
// secret is missing so the bot never boots half-configured.
require('dotenv').config();

const path = require('path');

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    // eslint-disable-next-line no-console
    console.error(`[config] Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value.trim();
}

const projectRoot = path.resolve(__dirname, '..');
const dbPathRaw = process.env.DB_PATH && process.env.DB_PATH.trim()
  ? process.env.DB_PATH.trim()
  : './data/cheki.db';

const config = {
  token: required('DISCORD_TOKEN'),
  appId: required('APP_ID'),
  guildId: required('GUILD_ID'),
  dbPath: path.isAbsolute(dbPathRaw) ? dbPathRaw : path.join(projectRoot, dbPathRaw),
  projectRoot,
  imagesDir: path.join(projectRoot, 'data', 'images'),
  tz: process.env.TZ || 'Asia/Bangkok',
  // Optional bootstrap values (operational config lives in the DB once set).
  bootstrapAdminRoleId: process.env.ADMIN_ROLE_ID || null,
  bootstrapPromptpayId: process.env.PROMPTPAY_ID || null,
};

module.exports = config;

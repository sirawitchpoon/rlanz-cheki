'use strict';

// Central interaction dispatcher. Routes slash commands, buttons, and modal
// submits by parsing their name / custom_id. Because routing is by custom_id
// (not stored listeners), every button keeps working after a bot restart.
const { MessageFlags } = require('discord.js');
const logger = require('../logger');
const { parse } = require('./ids');
const itemButtons = require('./buttons/itemButtons');
const ticketButtons = require('./buttons/ticketButtons');
const setupButtons = require('./buttons/setupButtons');
const itemModal = require('./modals/itemModal');
const scheduleModal = require('./modals/scheduleModal');
const shipModal = require('./modals/shipModal');
const chekiCommand = require('../commands/cheki');

async function routeButton(interaction) {
  const { ns, parts } = parse(interaction.customId);
  if (ns === 'item') {
    const itemId = Number(parts[1]);
    const action = parts[2];
    if (action === 'reserve') return itemButtons.reserve(interaction, itemId);
    if (action === 'check') return itemButtons.check(interaction, itemId);
    if (action === 'cancel') return itemButtons.cancel(interaction, itemId);
  } else if (ns === 'tk') {
    const itemId = Number(parts[1]);
    const action = parts[2];
    if (action === 'confirm') return ticketButtons.confirm(interaction, itemId);
    if (action === 'release') return ticketButtons.release(interaction, itemId);
  } else if (ns === 'setup') {
    const sub = parts[1];
    if (sub === 'edit') return setupButtons.edit(interaction, Number(parts[2]));
    if (sub === 'schedule') return setupButtons.schedule(interaction);
    if (sub === 'preview') return setupButtons.preview(interaction);
    if (sub === 'publish') return setupButtons.publish(interaction);
    if (sub === 'cleanup') return setupButtons.cleanup(interaction);
  }
  return undefined;
}

async function routeModal(interaction) {
  const { ns, parts } = parse(interaction.customId);
  if (ns !== 'm') return undefined;
  const type = parts[1];
  if (type === 'item') return itemModal.submit(interaction, Number(parts[2]));
  if (type === 'schedule') return scheduleModal.submit(interaction, Number(parts[2]));
  if (type === 'ship') return shipModal.submit(interaction, Number(parts[2]));
  return undefined;
}

async function safeError(interaction) {
  const msg = 'เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะคะ 🙏';
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    } else if (interaction.isRepliable()) {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // interaction may have expired or already been acknowledged (e.g. showModal)
  }
}

async function route(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'cheki') return await chekiCommand.execute(interaction);
      return undefined;
    }
    if (interaction.isButton()) return await routeButton(interaction);
    if (interaction.isModalSubmit()) return await routeModal(interaction);
    return undefined;
  } catch (err) {
    logger.error(`interaction error (${interaction.type}): ${err.stack || err.message}`);
    await safeError(interaction);
    return undefined;
  }
}

module.exports = { route };

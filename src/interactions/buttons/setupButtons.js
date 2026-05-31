'use strict';

// Setup Control Panel buttons (admin-only): edit item, schedule, preview,
// publish, cleanup.
const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const repo = require('../../db/repo');
const dropService = require('../../services/dropService');
const ticketService = require('../../services/ticketService');
const embedService = require('../../services/embedService');
const setupPanel = require('../setupPanel');
const { isAdmin } = require('../guards');
const { ids } = require('../ids');
const { discordTime, toBangkokInput } = require('../../lib/time');

function denyIfNotAdmin(interaction) {
  const config = repo.getConfig();
  if (!isAdmin(interaction, config)) {
    interaction.reply({ content: 'ไม่มีสิทธิ์ใช้ปุ่มนี้', flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}

async function edit(interaction, slot) {
  if (denyIfNotAdmin(interaction)) return undefined;
  const drop = repo.getCurrentDrop();
  if (!drop) {
    return interaction.reply({ content: 'ยังไม่มี drop ใช้ /cheki init ก่อน', flags: MessageFlags.Ephemeral });
  }
  const item = repo.getItemBySlot(drop.id, slot);
  if (!item) return interaction.reply({ content: 'ไม่พบลายนี้', flags: MessageFlags.Ephemeral });

  const modal = new ModalBuilder()
    .setCustomId(ids.modalItem(item.id))
    .setTitle(`แก้ไขเชกิลายที่ ${slot}`);
  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('ชื่อลาย')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);
  const descInput = new TextInputBuilder()
    .setCustomId('desc')
    .setLabel('คำอธิบาย (ไม่บังคับ)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
  const priceInput = new TextInputBuilder()
    .setCustomId('price')
    .setLabel('ราคา (บาท) เช่น 349 หรือ 349.50')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(12);
  if (item.title) titleInput.setValue(item.title);
  if (item.description) descInput.setValue(item.description);
  if (item.price_satang != null) priceInput.setValue(String(item.price_satang / 100));

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(priceInput),
  );
  return interaction.showModal(modal);
}

async function schedule(interaction) {
  if (denyIfNotAdmin(interaction)) return undefined;
  const drop = repo.getCurrentDrop();
  if (!drop) {
    return interaction.reply({ content: 'ยังไม่มี drop ใช้ /cheki init ก่อน', flags: MessageFlags.Ephemeral });
  }
  const modal = new ModalBuilder()
    .setCustomId(ids.modalSchedule(drop.id))
    .setTitle('ตั้งเวลาเปิดขาย');
  const timeInput = new TextInputBuilder()
    .setCustomId('publish')
    .setLabel('เวลาเปิดขาย (YYYY-MM-DD HH:mm)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('2026-06-05 20:00');
  const leadInput = new TextInputBuilder()
    .setCustomId('lead')
    .setLabel('สปอยก่อนกี่นาที (0 = ไม่สปอย)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('60');
  if (drop.publish_at) timeInput.setValue(toBangkokInput(drop.publish_at));
  modal.addComponents(
    new ActionRowBuilder().addComponents(timeInput),
    new ActionRowBuilder().addComponents(leadInput),
  );
  return interaction.showModal(modal);
}

async function preview(interaction) {
  if (denyIfNotAdmin(interaction)) return undefined;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const drop = repo.getCurrentDrop();
  if (!drop) return interaction.editReply('ยังไม่มี drop');
  const items = repo.getItemsByDrop(drop.id);
  const embeds = [];
  const files = [];
  for (const it of items) {
    const p = embedService.buildSalePayload(it, repo.countQueue(it.id), {
      attachmentBase: `preview-${it.slot}`,
    });
    embeds.push(...p.embeds);
    files.push(...p.files);
  }
  return interaction.editReply({ content: 'พรีวิว 5 ลาย (เห็นเฉพาะคุณ):', embeds, files });
}

async function publish(interaction) {
  if (denyIfNotAdmin(interaction)) return undefined;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = repo.getConfig();
  const drop = repo.getCurrentDrop();
  if (!drop) return interaction.editReply('ยังไม่มี drop');
  if (!config || !config.announce_channel_id) {
    return interaction.editReply('ยังไม่ได้ตั้งห้องประกาศขาย — ใช้ /cheki config ก่อน');
  }
  if (!config.promptpay_id && !config.qr_image_path) {
    return interaction.editReply('ยังไม่ได้ตั้งวิธีรับเงิน — ใช้ /cheki config ใส่ promptpay_id หรืออัป qr_image ก่อน');
  }
  if (!repo.isDropComplete(drop.id)) {
    return interaction.editReply('ข้อมูลยังไม่ครบ — ต้องมีชื่อ ราคา และรูป ครบทั้ง 5 ลาย');
  }
  if (!drop.publish_at) {
    return interaction.editReply('ยังไม่ได้ตั้งเวลา — กด "ตั้งเวลาดรอป" ก่อน');
  }
  repo.setDropState(drop.id, 'scheduled');
  dropService.armTimers(drop.id);
  await setupPanel.refresh(drop.id);
  return interaction.editReply(
    `🚀 ตั้งตารางขายเรียบร้อย! จะเปิดขาย ${discordTime(drop.publish_at, 'F')} (${discordTime(drop.publish_at, 'R')})` +
      (drop.teaser_at ? `\nสปอยตอน ${discordTime(drop.teaser_at, 'F')}` : ''),
  );
}

async function cleanup(interaction) {
  if (denyIfNotAdmin(interaction)) return undefined;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const drop = repo.getCurrentDrop() || repo.getLatestDrop();
  if (!drop) return interaction.editReply('ไม่มี drop');
  const n = await ticketService.cleanupAll(drop.id);
  return interaction.editReply(`🧹 ลบห้องส่วนตัวแล้ว ${n} ห้อง (ข้อมูลออเดอร์ถูกบันทึกไว้แล้ว)`);
}

module.exports = { edit, schedule, preview, publish, cleanup };

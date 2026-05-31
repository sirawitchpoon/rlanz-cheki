'use strict';

// Admin buttons inside a private ticket channel: confirm sale / release queue.
const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const repo = require('../../db/repo');
const queueService = require('../../services/queueService');
const { isAdmin } = require('../guards');
const { ids } = require('../ids');

async function confirm(interaction, itemId) {
  const config = repo.getConfig();
  if (!isAdmin(interaction, config)) {
    return interaction.reply({ content: 'ไม่มีสิทธิ์ใช้ปุ่มนี้', flags: MessageFlags.Ephemeral });
  }
  const ticket = repo.getTicket(itemId);
  if (!ticket || !ticket.buyer_user_id) {
    return interaction.reply({ content: 'ยังไม่มีผู้ซื้อในคิวนี้', flags: MessageFlags.Ephemeral });
  }
  // Capture the shipping address into the order record before confirming.
  const modal = new ModalBuilder()
    .setCustomId(ids.modalShip(itemId))
    .setTitle('บันทึกที่อยู่จัดส่ง');
  const input = new TextInputBuilder()
    .setCustomId('ship')
    .setLabel('ชื่อผู้รับ / ที่อยู่ / เบอร์โทร')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder('คัดลอกที่อยู่ที่ผู้ซื้อพิมพ์ไว้มาวางที่นี่');
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function release(interaction, itemId) {
  const config = repo.getConfig();
  if (!isAdmin(interaction, config)) {
    return interaction.reply({ content: 'ไม่มีสิทธิ์ใช้ปุ่มนี้', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const res = await queueService.releaseAndAdvance(itemId);
  if (res.error) return interaction.editReply('ไม่พบลายนี้');
  if (res.sold) return interaction.editReply('ลายนี้ขายไปแล้ว');
  if (res.nextUserId) {
    return interaction.editReply(`⏭️ ข้ามคิวแล้ว คิวถัดไปคือ <@${res.nextUserId}> (ส่ง QR ให้ใหม่ในห้องนี้แล้ว)`);
  }
  return interaction.editReply('⏭️ ข้ามคิวแล้ว ไม่มีคิวถัดไป — ลายนี้กลับไปเปิดจองอีกครั้ง');
}

module.exports = { confirm, release };

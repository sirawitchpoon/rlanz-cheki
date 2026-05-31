'use strict';

// Handles the shipping-note modal submit (shown when an admin clicks Confirm).
// Records the address + order snapshot and finalises the sale.
const { MessageFlags } = require('discord.js');
const repo = require('../../db/repo');
const queueService = require('../../services/queueService');
const ticketService = require('../../services/ticketService');
const { isAdmin } = require('../guards');

async function submit(interaction, itemId) {
  const config = repo.getConfig();
  if (!isAdmin(interaction, config)) {
    return interaction.reply({ content: 'ไม่มีสิทธิ์', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const note = interaction.fields.getTextInputValue('ship').trim();
  const ticket = repo.getTicket(itemId);
  const buyerId = ticket && ticket.buyer_user_id;
  if (!buyerId) return interaction.editReply('ไม่พบผู้ซื้อในคิวนี้');

  const res = await queueService.confirmSold(itemId, buyerId, note);
  if (res.error) return interaction.editReply('ไม่พบลายนี้');
  if (res.already) return interaction.editReply('ลายนี้ยืนยันการขายไปแล้ว');

  // Thank the buyer in the private channel.
  try {
    if (ticket.channel_id) {
      const channel = await ticketService.fetchChannelSafe(ticket.channel_id);
      if (channel) {
        await channel.send(
          `✅ ยืนยันการชำระเงินเรียบร้อย ขอบคุณ <@${buyerId}> มากค่ะ 💖\n` +
            'แอดมินจะดำเนินการจัดส่งและแจ้งเลขพัสดุต่อไปนะคะ',
        );
      }
    }
  } catch {
    // non-fatal
  }

  return interaction.editReply(
    `ยืนยันการขายเชกิลายที่ ${res.item.slot} ให้ <@${buyerId}> แล้ว ✅\nบันทึกออเดอร์ + ที่อยู่จัดส่งเรียบร้อย`,
  );
}

module.exports = { submit };

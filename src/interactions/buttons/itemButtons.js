'use strict';

// Public buyer buttons on each live sale message: reserve / check / cancel.
const { MessageFlags } = require('discord.js');
const queueService = require('../../services/queueService');

async function reserve(interaction, itemId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const res = await queueService.reserve(itemId, interaction.user.id);
  if (res.error) return interaction.editReply('ไม่พบลายนี้');
  if (res.sold) return interaction.editReply('ลายนี้ขายไปแล้ว 😢');
  if (res.already) {
    return interaction.editReply(
      `คุณอยู่ในคิวอยู่แล้ว — คิวที่ **${res.position}**${res.active ? ' (คุณคือคิวแรก! ไปชำระเงินในห้องส่วนตัวได้เลย)' : ''}`,
    );
  }
  if (res.becameFirst) {
    return interaction.editReply(
      `🎉 คุณได้สิทธิ์คิวแรก! ไปที่ห้อง ${res.channelId ? `<#${res.channelId}>` : 'ส่วนตัว'} เพื่อชำระเงินได้เลยค่ะ`,
    );
  }
  return interaction.editReply(`✅ จองสำเร็จ! คุณอยู่คิวที่ **${res.position}** — รอแอดมินเรียกตามคิว`);
}

async function check(interaction, itemId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const res = queueService.check(itemId, interaction.user.id);
  if (res.error) return interaction.editReply('ไม่พบลายนี้');
  if (res.sold) return interaction.editReply('ลายนี้ขายไปแล้ว');
  if (res.position == null) {
    return interaction.editReply(`คุณยังไม่ได้จองลายนี้ (ขณะนี้มีคนในคิว ${res.queueCount} คน)`);
  }
  return interaction.editReply(
    `คุณอยู่คิวที่ **${res.position}** จากทั้งหมด **${res.queueCount}** คน`,
  );
}

async function cancel(interaction, itemId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const res = await queueService.cancel(itemId, interaction.user.id);
  if (res.notInQueue) return interaction.editReply('คุณไม่ได้อยู่ในคิวของลายนี้');
  return interaction.editReply('ยกเลิกการจองเรียบร้อยแล้ว ✅');
}

module.exports = { reserve, check, cancel };

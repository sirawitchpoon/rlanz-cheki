'use strict';

// Handles the item-edit modal submit (title / description / price).
const { MessageFlags } = require('discord.js');
const repo = require('../../db/repo');
const setupPanel = require('../setupPanel');
const { isAdmin } = require('../guards');

// "349", "349.50", "฿1,200" -> satang integer, or null if invalid.
function parsePriceToSatang(raw) {
  const cleaned = String(raw).replace(/[,฿\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const baht = parseFloat(cleaned);
  if (!(baht > 0) || baht > 500000) return null;
  return Math.round(baht * 100);
}

async function submit(interaction, itemId) {
  const config = repo.getConfig();
  if (!isAdmin(interaction, config)) {
    return interaction.reply({ content: 'ไม่มีสิทธิ์', flags: MessageFlags.Ephemeral });
  }
  const item = repo.getItem(itemId);
  if (!item) return interaction.reply({ content: 'ไม่พบลายนี้', flags: MessageFlags.Ephemeral });

  const title = interaction.fields.getTextInputValue('title').trim();
  const desc = (interaction.fields.getTextInputValue('desc') || '').trim();
  const priceRaw = interaction.fields.getTextInputValue('price').trim();
  const satang = parsePriceToSatang(priceRaw);
  if (satang == null) {
    return interaction.reply({
      content: 'ราคาไม่ถูกต้อง ใส่เป็นตัวเลข เช่น 349 หรือ 349.50',
      flags: MessageFlags.Ephemeral,
    });
  }

  repo.updateItemDetails(itemId, { title, description: desc || null, priceSatang: satang });
  await setupPanel.refresh(item.drop_id);
  return interaction.reply({
    content: `บันทึกข้อมูลเชกิลายที่ ${item.slot} แล้ว ✅ (อย่าลืมอัปรูปด้วย /cheki image)`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { submit, parsePriceToSatang };

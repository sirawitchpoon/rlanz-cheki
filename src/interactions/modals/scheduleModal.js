'use strict';

// Handles the schedule modal submit. Stores the publish/teaser times on the
// drop but does NOT go live — the admin still presses "ยืนยันตารางขาย".
const { MessageFlags } = require('discord.js');
const repo = require('../../db/repo');
const setupPanel = require('../setupPanel');
const { isAdmin } = require('../guards');
const { parseBangkok, nowSeconds, formatBangkok } = require('../../lib/time');

async function submit(interaction, dropId) {
  const config = repo.getConfig();
  if (!isAdmin(interaction, config)) {
    return interaction.reply({ content: 'ไม่มีสิทธิ์', flags: MessageFlags.Ephemeral });
  }
  const drop = repo.getDrop(dropId);
  if (!drop) return interaction.reply({ content: 'ไม่พบ drop', flags: MessageFlags.Ephemeral });

  const publishRaw = interaction.fields.getTextInputValue('publish').trim();
  const leadRaw = (interaction.fields.getTextInputValue('lead') || '').trim();

  const publishAt = parseBangkok(publishRaw);
  if (publishAt == null) {
    return interaction.reply({
      content: 'รูปแบบเวลาไม่ถูกต้อง ใช้ YYYY-MM-DD HH:mm เช่น 2026-06-05 20:00',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (publishAt <= nowSeconds()) {
    return interaction.reply({
      content: 'เวลาเปิดขายต้องเป็นเวลาในอนาคต',
      flags: MessageFlags.Ephemeral,
    });
  }

  let lead = 0;
  if (leadRaw) {
    const n = parseInt(leadRaw, 10);
    if (Number.isNaN(n) || n < 0 || n > 10080) {
      return interaction.reply({
        content: 'จำนวนนาทีสปอยไม่ถูกต้อง (0–10080)',
        flags: MessageFlags.Ephemeral,
      });
    }
    lead = n;
  }
  const teaserAt = lead > 0 ? publishAt - lead * 60 : null;

  repo.setDropTimes(dropId, publishAt, teaserAt);
  await setupPanel.refresh(dropId);
  return interaction.reply({
    content:
      `ตั้งเวลาแล้ว ✅ เปิดขาย: ${formatBangkok(publishAt)}` +
      (teaserAt ? `\nสปอย: ${formatBangkok(teaserAt)}` : '\n(ไม่มีช่วงสปอย)') +
      '\n\nกด **"ยืนยันตารางขาย"** เพื่อเริ่มจับเวลา',
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { submit };

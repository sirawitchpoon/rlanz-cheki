'use strict';

// Builds and refreshes the admin Setup Control Panel — a single bot message in
// the setup channel listing the 5 slots and holding the setup buttons. It is
// just a message with known custom_ids, so it keeps working across restarts.
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const repo = require('../db/repo');
const ctx = require('../lib/context');
const { ids } = require('./ids');
const { formatBaht } = require('../services/embedService');
const { discordTime, formatBangkok } = require('../lib/time');

function buildPanel(dropId) {
  const drop = repo.getDrop(dropId);
  const items = repo.getItemsByDrop(dropId);

  const embed = new EmbedBuilder()
    .setTitle('🛠️ แผงควบคุมการขายเชกิ (เห็นเฉพาะแอดมิน)')
    .setColor(0x5865f2);

  const lines = items.map((it) => {
    const complete = it.title && it.price_satang != null && it.image_path;
    const img = it.image_path ? '🖼️' : '❌';
    return (
      `${complete ? '✅' : '⬜'} **ลายที่ ${it.slot}** · ` +
      `${it.title || '_(ยังไม่ตั้งชื่อ)_'} · ${formatBaht(it.price_satang)} · รูป ${img} · ` +
      `\`${it.status}\``
    );
  });
  embed.setDescription(lines.join('\n') || 'ยังไม่มีลาย');

  let sched = '_ยังไม่ได้ตั้งเวลา_';
  if (drop.publish_at) {
    sched =
      `เปิดขาย: ${formatBangkok(drop.publish_at)} — ${discordTime(drop.publish_at, 'R')}` +
      (drop.teaser_at ? `\nสปอย: ${formatBangkok(drop.teaser_at)}` : '');
  }
  embed.addFields(
    { name: 'สถานะ Drop', value: `\`${drop.state}\``, inline: true },
    { name: 'ตารางเวลา', value: sched, inline: false },
  );
  embed.setFooter({
    text: 'แก้ข้อมูลแต่ละลาย → อัปรูปด้วย /cheki image → ตั้งเวลา → ยืนยันตารางขาย',
  });

  const rowEdit = new ActionRowBuilder().addComponents(
    ...items.map((it) =>
      new ButtonBuilder()
        .setCustomId(ids.setupEdit(it.slot))
        .setLabel(`แก้ #${it.slot}`)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  const rowActions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.setupSchedule)
      .setLabel('ตั้งเวลาดรอป')
      .setEmoji('⏰')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(ids.setupPreview)
      .setLabel('พรีวิว')
      .setEmoji('👁️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(ids.setupPublish)
      .setLabel('ยืนยันตารางขาย')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Success),
  );
  const rowDanger = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.setupCleanup)
      .setLabel('ลบห้องส่วนตัวทั้งหมด')
      .setEmoji('🧹')
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [rowEdit, rowActions, rowDanger] };
}

// Edit the stored panel message to reflect current state. No-ops if missing.
async function refresh(dropId) {
  const drop = repo.getDrop(dropId);
  if (!drop || !drop.panel_channel_id || !drop.panel_message_id) return;
  try {
    const channel = await ctx.getClient().channels.fetch(drop.panel_channel_id);
    const msg = await channel.messages.fetch(drop.panel_message_id);
    await msg.edit(buildPanel(dropId));
  } catch {
    // panel message deleted or inaccessible — ignore
  }
}

module.exports = { buildPanel, refresh };

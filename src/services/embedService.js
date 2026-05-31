'use strict';

// Builds the public sale embed + buttons and is the single chokepoint for
// updating a live item message. Centralising here keeps the embed consistent
// and ensures we edit once per state change (respecting the ~5 edits/5s limit).
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const repo = require('../db/repo');
const ctx = require('../lib/context');
const logger = require('../logger');
const { ids } = require('../interactions/ids');
const { satangToBaht } = require('./qrService');
const { discordTime } = require('../lib/time');

const STATUS = {
  available: { emoji: '🟢', label: 'ว่าง (เปิดจอง)', color: 0x57f287 },
  reserved: { emoji: '🟡', label: 'กำลังชำระเงิน', color: 0xfee75c },
  sold: { emoji: '🔴', label: 'ขายแล้ว', color: 0xed4245 },
  draft: { emoji: '⚪', label: 'ยังไม่เปิดขาย', color: 0x99aab5 },
};

function formatBaht(satang) {
  if (satang == null) return '-';
  return `฿${satangToBaht(satang).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function imageAttachment(item, baseName = 'cheki') {
  if (!item.image_path) return null;
  const ext = path.extname(item.image_path || item.image_filename || '') || '.png';
  const name = `${baseName}${ext}`;
  return { attachment: new AttachmentBuilder(item.image_path, { name }), name };
}

// Buttons for a live sale message. All disabled once sold.
function buildButtons(item) {
  const sold = item.status === 'sold';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.itemReserve(item.id))
      .setLabel('จอง')
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(sold),
    new ButtonBuilder()
      .setCustomId(ids.itemCheck(item.id))
      .setLabel('เช็คคิว')
      .setEmoji('🔢')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(sold),
    new ButtonBuilder()
      .setCustomId(ids.itemCancel(item.id))
      .setLabel('ยกเลิกการจอง')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(sold),
  );
  return row;
}

// The full message payload for a live/refresh edit. We re-attach the image each
// time (state changes are infrequent) so embed images never break on expiry.
// opts.attachmentBase makes the attachment name unique (needed when several
// embeds share one message, e.g. the preview).
function buildSalePayload(item, queueCount, opts = {}) {
  const meta = STATUS[item.status] || STATUS.draft;
  const embed = new EmbedBuilder()
    .setTitle(`เชกิลายที่ ${item.slot}${item.title ? ` — ${item.title}` : ''}`)
    .setColor(meta.color)
    .addFields(
      { name: 'ราคา', value: formatBaht(item.price_satang), inline: true },
      { name: 'สถานะ', value: `${meta.emoji} ${meta.label}`, inline: true },
      { name: 'คิว', value: `${queueCount} คน`, inline: true },
    );
  if (item.description) embed.setDescription(item.description);

  const files = [];
  const att = imageAttachment(item, opts.attachmentBase || 'cheki');
  if (att) {
    embed.setImage(`attachment://${att.name}`);
    files.push(att.attachment);
  }

  if (item.status === 'sold') {
    embed.setFooter({ text: 'ปิดการขายแล้ว ขอบคุณค่ะ 💖' });
  } else if (item.status === 'reserved') {
    embed.setFooter({ text: 'มีผู้ซื้อกำลังชำระเงิน — กดจองเพื่อต่อคิวสำรองได้' });
  } else {
    embed.setFooter({ text: 'กด "จอง" เพื่อเข้าคิว · คิวแรกที่ยืนยันได้สิทธิ์ซื้อ' });
  }

  return {
    embeds: [embed],
    files,
    attachments: [], // drop any previously-attached files on edit
    components: item.status === 'sold' ? [] : [buildButtons(item)],
  };
}

// Teaser payload: a spoiler-blurred image + countdown. The image is attached as
// a SPOILER_ file so Discord blurs it until the drop reveals it.
function buildTeaserPayload(item, publishAt) {
  const embed = new EmbedBuilder()
    .setTitle(`🔒 เชกิลายที่ ${item.slot} — เร็วๆ นี้`)
    .setColor(0x5865f2)
    .setDescription(
      `เปิดขาย ${discordTime(publishAt, 'F')}\n` +
        `อีก ${discordTime(publishAt, 'R')} 👀`,
    )
    .setFooter({ text: 'ภาพถูกเบลอไว้ จะเปิดเผยตอนเริ่มขาย' });

  const files = [];
  if (item.image_path) {
    const ext = path.extname(item.image_path) || '.png';
    files.push(
      new AttachmentBuilder(item.image_path, { name: `SPOILER_teaser${ext}` }),
    );
  }
  return { embeds: [embed], files, attachments: [], components: [] };
}

// Edit the live public message to reflect current state. Safe to call after any
// state change. No-ops gracefully if the message/channel is gone.
async function refreshItem(itemId) {
  const item = repo.getItem(itemId);
  if (!item || !item.public_message_id) return;
  const config = repo.getConfig();
  if (!config || !config.announce_channel_id) return;
  try {
    const channel = await ctx.getClient().channels.fetch(config.announce_channel_id);
    const message = await channel.messages.fetch(item.public_message_id);
    const queueCount = repo.countQueue(itemId);
    await message.edit(buildSalePayload(item, queueCount));
  } catch (err) {
    logger.warn(`refreshItem(${itemId}) failed: ${err.message}`);
  }
}

module.exports = {
  STATUS,
  formatBaht,
  buildButtons,
  buildSalePayload,
  buildTeaserPayload,
  refreshItem,
  imageAttachment,
};

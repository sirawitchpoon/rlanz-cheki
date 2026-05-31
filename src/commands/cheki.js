'use strict';

// The single /cheki command tree. Subcommands:
//   config        set admin role / announce channel / ticket category / promptpay id
//   init          create a fresh drop + post the Setup Control Panel here
//   image         upload/replace a design image for a slot
//   preview       ephemeral preview of all 5 sale embeds
//   status        show drop + queue status
//   cancel-drop   abort the current setup/scheduled drop
const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
} = require('discord.js');
const repo = require('../db/repo');
const config = require('../config');
const logger = require('../logger');
const dropService = require('../services/dropService');
const setupButtons = require('../interactions/buttons/setupButtons');
const setupPanel = require('../interactions/setupPanel');
const embedService = require('../services/embedService');
const { isAdmin } = require('../interactions/guards');
const { discordTime, formatBangkok } = require('../lib/time');

const data = new SlashCommandBuilder()
  .setName('cheki')
  .setDescription('ระบบขายเชกิแบบดรอป (สำหรับแอดมิน)')
  .addSubcommand((s) =>
    s
      .setName('config')
      .setDescription('ตั้งค่าระบบ (role/ห้อง/พร้อมเพย์)')
      .addRoleOption((o) =>
        o.setName('admin_role').setDescription('Role ของแอดมิน').setRequired(false),
      )
      .addChannelOption((o) =>
        o
          .setName('announce_channel')
          .setDescription('ห้องที่จะโพสต์ประกาศขาย')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      )
      .addChannelOption((o) =>
        o
          .setName('ticket_category')
          .setDescription('หมวดหมู่ (category) สำหรับสร้างห้องส่วนตัว')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('promptpay_id')
          .setDescription('เบอร์พร้อมเพย์ หรือเลขบัตรประชาชน 13 หลัก')
          .setRequired(false),
      ),
  )
  .addSubcommand((s) =>
    s.setName('init').setDescription('สร้างดรอปใหม่ + วางแผงควบคุมในห้องนี้'),
  )
  .addSubcommand((s) =>
    s
      .setName('image')
      .setDescription('อัปโหลด/เปลี่ยนรูปของลาย')
      .addIntegerOption((o) =>
        o
          .setName('slot')
          .setDescription('ลายที่ (1-5)')
          .setMinValue(1)
          .setMaxValue(5)
          .setRequired(true),
      )
      .addAttachmentOption((o) =>
        o.setName('file').setDescription('ไฟล์รูปเชกิ').setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName('preview').setDescription('พรีวิว 5 ลาย (เห็นเฉพาะคุณ)'))
  .addSubcommand((s) => s.setName('status').setDescription('ดูสถานะดรอปและคิว'))
  .addSubcommand((s) => s.setName('cancel-drop').setDescription('ยกเลิกดรอปปัจจุบัน'));

async function execute(interaction) {
  const cfg = repo.getConfig();
  if (!isAdmin(interaction, cfg)) {
    return interaction.reply({ content: 'คำสั่งนี้สำหรับแอดมินเท่านั้น', flags: MessageFlags.Ephemeral });
  }
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'config':
      return doConfig(interaction);
    case 'init':
      return doInit(interaction);
    case 'image':
      return doImage(interaction);
    case 'preview':
      return setupButtons.preview(interaction);
    case 'status':
      return doStatus(interaction);
    case 'cancel-drop':
      return doCancelDrop(interaction);
    default:
      return interaction.reply({ content: 'ไม่รู้จักคำสั่งย่อยนี้', flags: MessageFlags.Ephemeral });
  }
}

async function doConfig(interaction) {
  const patch = { guild_id: interaction.guildId };
  const role = interaction.options.getRole('admin_role');
  const announce = interaction.options.getChannel('announce_channel');
  const category = interaction.options.getChannel('ticket_category');
  const promptpay = interaction.options.getString('promptpay_id');
  if (role) patch.admin_role_id = role.id;
  if (announce) patch.announce_channel_id = announce.id;
  if (category) patch.ticket_category_id = category.id;
  if (promptpay) patch.promptpay_id = promptpay.replace(/[\s-]/g, '');

  const saved = repo.upsertConfig(patch);
  const summary = [
    `Admin role: ${saved.admin_role_id ? `<@&${saved.admin_role_id}>` : '—'}`,
    `ห้องประกาศ: ${saved.announce_channel_id ? `<#${saved.announce_channel_id}>` : '—'}`,
    `Category ห้องส่วนตัว: ${saved.ticket_category_id ? `<#${saved.ticket_category_id}>` : '—'}`,
    `PromptPay: ${saved.promptpay_id ? `\`${saved.promptpay_id}\`` : '—'}`,
  ].join('\n');
  return interaction.reply({ content: `บันทึกการตั้งค่าแล้ว ✅\n${summary}`, flags: MessageFlags.Ephemeral });
}

async function doInit(interaction) {
  const existing = repo.getCurrentDrop();
  if (existing) {
    return interaction.reply({
      content: `มีดรอปที่ยังไม่จบอยู่ (id ${existing.id}, สถานะ \`${existing.state}\`) — ใช้ /cheki cancel-drop ก่อนถ้าต้องการเริ่มใหม่`,
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const dropId = repo.createDropWithItems();
  // The setup channel is wherever init is run; store it.
  repo.upsertConfig({ guild_id: interaction.guildId, setup_channel_id: interaction.channelId });
  const panelMsg = await interaction.channel.send(setupPanel.buildPanel(dropId));
  repo.setDropPanel(dropId, interaction.channelId, panelMsg.id);
  logger.info(`Created drop ${dropId}, panel in ${interaction.channelId}`);
  return interaction.editReply(
    `สร้างดรอปใหม่แล้ว ✅ (id ${dropId})\nแผงควบคุมอยู่ด้านบน — เริ่มจากกด "แก้ #1..#5" แล้วอัปรูปด้วย /cheki image`,
  );
}

const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

async function doImage(interaction) {
  const drop = repo.getCurrentDrop();
  if (!drop) {
    return interaction.reply({ content: 'ยังไม่มีดรอป ใช้ /cheki init ก่อน', flags: MessageFlags.Ephemeral });
  }
  const slot = interaction.options.getInteger('slot');
  const file = interaction.options.getAttachment('file');
  const item = repo.getItemBySlot(drop.id, slot);
  if (!item) return interaction.reply({ content: 'ไม่พบลายนี้', flags: MessageFlags.Ephemeral });

  const isImage =
    (file.contentType && file.contentType.startsWith('image/')) ||
    ALLOWED_IMAGE_EXT.has(path.extname(file.name || '').toLowerCase());
  if (!isImage) {
    return interaction.reply({ content: 'ไฟล์ต้องเป็นรูปภาพ (png/jpg/webp/gif)', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const ext = (path.extname(file.name || '') || '.png').toLowerCase();
    const dir = path.join(config.imagesDir, String(drop.id));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${slot}${ext}`);

    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);

    repo.setItemImage(item.id, dest, file.name || `${slot}${ext}`);
    await setupPanel.refresh(drop.id);
    return interaction.editReply(`อัปโหลดรูปเชกิลายที่ ${slot} แล้ว ✅`);
  } catch (err) {
    logger.error(`image upload slot ${slot} failed: ${err.message}`);
    return interaction.editReply('อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
  }
}

async function doStatus(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const drop = repo.getCurrentDrop() || repo.getLatestDrop();
  if (!drop) return interaction.editReply('ยังไม่มีดรอป');
  const items = repo.getItemsByDrop(drop.id);
  const embed = new EmbedBuilder()
    .setTitle(`สถานะดรอป #${drop.id}`)
    .setColor(0x5865f2)
    .addFields({
      name: 'ภาพรวม',
      value:
        `สถานะ: \`${drop.state}\`\n` +
        (drop.publish_at
          ? `เปิดขาย: ${formatBangkok(drop.publish_at)} (${discordTime(drop.publish_at, 'R')})`
          : 'ยังไม่ตั้งเวลา'),
    });
  for (const it of items) {
    const meta = embedService.STATUS[it.status] || embedService.STATUS.draft;
    const active = repo.getActiveEntry(it.id);
    embed.addFields({
      name: `ลายที่ ${it.slot} — ${it.title || '(ยังไม่ตั้งชื่อ)'}`,
      value:
        `${meta.emoji} ${meta.label} · คิว ${repo.countQueue(it.id)} คน` +
        (active ? ` · คิวแรก: <@${active.user_id}>` : '') +
        (it.status === 'sold' && it.buyer_user_id ? ` · ผู้ซื้อ: <@${it.buyer_user_id}>` : ''),
    });
  }
  return interaction.editReply({ embeds: [embed] });
}

async function doCancelDrop(interaction) {
  const drop = repo.getCurrentDrop();
  if (!drop) return interaction.reply({ content: 'ไม่มีดรอปที่กำลังทำงาน', flags: MessageFlags.Ephemeral });
  dropService.cancelDrop(drop.id);
  await setupPanel.refresh(drop.id);
  return interaction.reply({
    content: `ยกเลิกดรอป #${drop.id} แล้ว ✅ (ห้องส่วนตัวยังอยู่ ใช้ปุ่ม "ลบห้องส่วนตัวทั้งหมด" ถ้าต้องการลบ)`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };

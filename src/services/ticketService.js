'use strict';

// Manages the private per-design payment channels ("tickets"). Strategy:
// create-on-demand, then REUSE the same channel as the queue advances
// (re-permission + purge history) rather than delete+recreate — this avoids the
// channel-create rate limit and a crash-mid-create window. Channels are only
// fully deleted via the admin Cleanup button in the setup channel.
const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const repo = require('../db/repo');
const ctx = require('../lib/context');
const logger = require('../logger');
const qrService = require('./qrService');
const { formatBaht } = require('./embedService');
const { ids } = require('../interactions/ids');

async function fetchChannelSafe(channelId) {
  if (!channelId) return null;
  try {
    return await ctx.getClient().channels.fetch(channelId);
  } catch {
    return null;
  }
}

async function safeBulkDelete(channel) {
  try {
    await channel.bulkDelete(100, true); // true = ignore messages older than 14d
  } catch (err) {
    logger.debug(`bulkDelete in ${channel.id} skipped: ${err.message}`);
  }
}

// Build permission overwrites for a ticket channel. If buyerUserId is null the
// channel is locked to admins + bot only (used when no buyer occupies it).
function buildOverwrites(guild, config, buyerUserId) {
  const botId = ctx.getClient().user.id;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];
  if (config.admin_role_id) {
    overwrites.push({
      id: config.admin_role_id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }
  if (buyerUserId) {
    overwrites.push({
      id: buyerUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }
  return overwrites;
}

// Build the control message: PromptPay QR (exact amount) + instructions + the
// admin Confirm/Release buttons. The buttons are visible to all in the channel
// but gated by an admin-role check in their handlers.
async function buildControlPayload(item, config, buyerUserId) {
  // Payment QR source: an uploaded static image takes priority; otherwise
  // generate a PromptPay QR with the exact amount embedded.
  const files = [];
  let imageName = null;
  let amountEmbedded = false;
  if (config.qr_image_path && fs.existsSync(config.qr_image_path)) {
    const ext = path.extname(config.qr_image_path) || '.png';
    imageName = `promptpay${ext}`;
    files.push(new AttachmentBuilder(config.qr_image_path, { name: imageName }));
  } else if (config.promptpay_id) {
    const qrBuffer = await qrService.generate(config.promptpay_id, item.price_satang);
    imageName = 'promptpay.png';
    files.push(new AttachmentBuilder(qrBuffer, { name: imageName }));
    amountEmbedded = true;
  }

  const step1 = amountEmbedded
    ? '1️⃣ สแกน QR ด้านล่าง — ยอดเงินถูกกำหนดไว้แล้ว (ตรวจให้ตรง)\n'
    : `1️⃣ สแกน QR ด้านล่าง แล้ว **กรอกยอดเอง = ${formatBaht(item.price_satang)}** ให้ตรงเป๊ะ\n`;

  const embed = new EmbedBuilder()
    .setTitle(`💳 ชำระเงิน — เชกิลายที่ ${item.slot}${item.title ? ` (${item.title})` : ''}`)
    .setColor(0xfee75c)
    .setDescription(
      `ยอดที่ต้องโอน: **${formatBaht(item.price_satang)}**\n\n` +
        '**ขั้นตอน**\n' +
        step1 +
        '2️⃣ ส่ง **รูปสลิป** ที่มี QR ตรวจสอบสลิป ในห้องนี้\n' +
        '3️⃣ พิมพ์ **ชื่อผู้รับ / ที่อยู่ / เบอร์โทร** สำหรับจัดส่ง\n\n' +
        'แล้วรอแอดมินตรวจสอบและยืนยันค่ะ 💖',
    )
    .setFooter({ text: 'ปุ่มด้านล่างสำหรับแอดมินเท่านั้น' });
  if (imageName) embed.setImage(`attachment://${imageName}`);

  const adminRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ids.tkConfirm(item.id))
      .setLabel('ยืนยันการขาย')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(ids.tkRelease(item.id))
      .setLabel('ปล่อยคิว / ข้าม #1')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    content: `<@${buyerUserId}> คุณได้สิทธิ์ซื้อ (คิวที่ 1) แล้ว 🎉 กรุณาชำระเงินภายในห้องนี้`,
    embeds: [embed],
    files,
    components: [adminRow],
  };
}

// Ensure a private channel exists for this item, is permissioned to buyerUserId,
// has clean history, and shows a fresh control/QR message. Used both for the
// first #1 and for every advance to a new buyer.
async function assign(itemId, buyerUserId) {
  const config = repo.getConfig();
  if (!config) throw new Error('config not set');
  const guild = ctx.getGuild();
  const item = repo.getItem(itemId);
  const ticket = repo.getTicket(itemId);

  let channel = await fetchChannelSafe(ticket && ticket.channel_id);

  if (channel) {
    // Reuse: reset perms to the new buyer (drops the previous buyer), purge.
    await channel.permissionOverwrites.set(buildOverwrites(guild, config, buyerUserId));
    await safeBulkDelete(channel);
  } else {
    channel = await guild.channels.create({
      name: `pay-slot-${item.slot}`,
      type: ChannelType.GuildText,
      parent: config.ticket_category_id || undefined,
      topic: `ห้องชำระเงินส่วนตัว เชกิลายที่ ${item.slot}`,
      permissionOverwrites: buildOverwrites(guild, config, buyerUserId),
    });
    repo.setTicketChannel(itemId, channel.id);
  }

  const payload = await buildControlPayload(item, config, buyerUserId);
  const msg = await channel.send(payload);
  repo.setTicketBuyer(itemId, buyerUserId);
  repo.setTicketState(itemId, 'awaiting_payment');
  repo.setTicketQrMessage(itemId, msg.id);
  return channel;
}

// Lock the channel to admins-only (no buyer) — used when the queue empties.
async function lockIdle(itemId) {
  const config = repo.getConfig();
  const guild = ctx.getGuild();
  const ticket = repo.getTicket(itemId);
  const channel = await fetchChannelSafe(ticket && ticket.channel_id);
  if (channel) {
    try {
      await channel.permissionOverwrites.set(buildOverwrites(guild, config, null));
      await channel.send('ℹ️ คิวว่างแล้ว ลายนี้กลับไปเปิดจองอีกครั้ง');
    } catch (err) {
      logger.warn(`lockIdle(${itemId}) failed: ${err.message}`);
    }
  }
  repo.setTicketBuyer(itemId, null);
  repo.setTicketState(itemId, 'idle');
}

// Post an admin-facing alert to the setup channel (fallback: announce channel).
// Used when an automatic action — e.g. opening a ticket channel — failed and a
// human needs to step in. Best-effort: never throws.
async function notifyAdmins(text) {
  const config = repo.getConfig();
  if (!config) return;
  const channelId = config.setup_channel_id || config.announce_channel_id;
  if (!channelId) return;
  const channel = await fetchChannelSafe(channelId);
  if (!channel) return;
  const mention = config.admin_role_id ? `<@&${config.admin_role_id}> ` : '';
  try {
    await channel.send({
      content: `${mention}${text}`,
      allowedMentions: { roles: config.admin_role_id ? [config.admin_role_id] : [] },
    });
  } catch (err) {
    logger.warn(`notifyAdmins failed: ${err.message}`);
  }
}

// Post a shipping/tracking notice into a sold item's private channel, mentioning
// the buyer, and record the tracking number on the order. Throws (with a short
// code) if the item/buyer/channel is missing so the caller can report why.
async function notifyTracking(itemId, trackingNo) {
  const tracking = String(trackingNo || '').trim();
  if (!tracking) throw new Error('no_tracking');
  const item = repo.getItem(itemId);
  if (!item) throw new Error('no_item');
  const ticket = repo.getTicket(itemId);
  const buyerId = (ticket && ticket.buyer_user_id) || item.buyer_user_id;
  if (!buyerId) throw new Error('no_buyer');
  const channel = await fetchChannelSafe(ticket && ticket.channel_id);
  if (!channel) throw new Error('no_channel');

  await channel.send({
    content:
      `📦 <@${buyerId}> พัสดุเชกิลายที่ ${item.slot}${item.title ? ` (${item.title})` : ''} จัดส่งแล้วค่ะ!\n` +
      `เลขติดตามพัสดุ: **${tracking}**\n` +
      'ขอบคุณที่อุดหนุนนะคะ ตรวจสอบสถานะพัสดุได้จากเลขด้านบนเลยค่ะ 💖',
    allowedMentions: { users: [buyerId] },
  });
  repo.setOrderTracking(itemId, tracking);
  logger.info(`tracking for item ${itemId} sent to ${buyerId} in ${channel.id}`);
  return { buyerId, channelId: channel.id, tracking };
}

// Delete every ticket channel of a drop and reset the rows. The ONLY deletion path.
async function cleanupAll(dropId) {
  const tickets = repo.getTicketsByDrop(dropId);
  let deleted = 0;
  for (const t of tickets) {
    if (t.channel_id) {
      const channel = await fetchChannelSafe(t.channel_id);
      if (channel) {
        try {
          await channel.delete('Cheki drop cleanup');
          deleted += 1;
        } catch (err) {
          logger.warn(`cleanup delete ${t.channel_id} failed: ${err.message}`);
        }
      }
      repo.setTicketChannel(t.item_id, null);
    }
    repo.setTicketBuyer(t.item_id, null);
    repo.setTicketState(t.item_id, 'idle');
  }
  return deleted;
}

module.exports = { assign, lockIdle, cleanupAll, notifyAdmins, notifyTracking, fetchChannelSafe, buildControlPayload };

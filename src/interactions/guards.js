'use strict';

const { PermissionsBitField } = require('discord.js');

// Admin authorization check. A user counts as an admin if ANY of:
//   1. they are the guild owner, OR
//   2. they have Discord-level Administrator or Manage Server permission, OR
//   3. they hold the configured admin role (config.admin_role_id).
//
// (1) and (2) are essential for BOOTSTRAP: /cheki config is what sets the admin
// role, so before it runs there is no role to check — without accepting server
// managers here, anyone who isn't the owner would be permanently locked out.
function isAdmin(interaction, config) {
  if (!interaction.inGuild || !interaction.inGuild()) return false;

  // 1) guild owner
  if (interaction.guild && interaction.guild.ownerId === interaction.user.id) return true;

  // 2) Discord-level server managers (covers the first-run bootstrap)
  const perms = interaction.memberPermissions;
  if (
    perms &&
    (perms.has(PermissionsBitField.Flags.Administrator) ||
      perms.has(PermissionsBitField.Flags.ManageGuild))
  ) {
    return true;
  }

  // 3) configured admin role
  const roleId = config && config.admin_role_id;
  if (!roleId) return false;
  const member = interaction.member;
  if (!member) return false;
  if (member.roles && member.roles.cache) return member.roles.cache.has(roleId);
  if (Array.isArray(member.roles)) return member.roles.includes(roleId); // raw API payload
  return false;
}

module.exports = { isAdmin };

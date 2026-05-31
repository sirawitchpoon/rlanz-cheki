'use strict';

// Admin authorization check. A user is an admin if they are the guild owner or
// hold the configured admin role.
function isAdmin(interaction, config) {
  if (!interaction.inGuild || !interaction.inGuild()) return false;
  if (interaction.guild && interaction.guild.ownerId === interaction.user.id) return true;
  const roleId = config && config.admin_role_id;
  if (!roleId) return false;
  const member = interaction.member;
  if (!member) return false;
  if (member.roles && member.roles.cache) return member.roles.cache.has(roleId);
  if (Array.isArray(member.roles)) return member.roles.includes(roleId); // raw API payload
  return false;
}

module.exports = { isAdmin };

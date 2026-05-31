'use strict';

// Time helpers. We interpret admin-entered times as Asia/Bangkok, which is a
// fixed UTC+7 offset (Thailand has no DST). We compute the UTC instant
// explicitly so the result is correct regardless of the server's system TZ.

const BANGKOK_OFFSET_SECONDS = 7 * 3600;

// Accepts "YYYY-MM-DD HH:mm" (or with 'T' separator, optional seconds).
// Returns unix seconds (integer) or null if it can't be parsed / is invalid.
function parseBangkok(input) {
  if (typeof input !== 'string') return null;
  const m = input
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const [, y, mo, d, h, mi, s] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s ? Number(s) : 0;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  // Date.UTC treats args as UTC; subtract the Bangkok offset to get the real
  // UTC instant for that Bangkok wall-clock time.
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(utcMs)) return null;

  // Reject impossible dates that Date.UTC silently rolls over (e.g. Feb 31).
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return Math.floor(utcMs / 1000) - BANGKOK_OFFSET_SECONDS;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// Discord dynamic timestamp markdown. style: 'R' relative, 'f' short datetime,
// 'F' long datetime, etc. Renders client-side in the viewer's locale/timezone.
function discordTime(unixSeconds, style = 'f') {
  return `<t:${unixSeconds}:${style}>`;
}

// Format a Bangkok wall-clock string for display (e.g. in previews/logs).
function formatBangkok(unixSeconds) {
  return `${toBangkokInput(unixSeconds)} (Asia/Bangkok)`;
}

// "YYYY-MM-DD HH:mm" in Bangkok time — the same format parseBangkok accepts, for
// prefilling the schedule modal.
function toBangkokInput(unixSeconds) {
  const d = new Date((unixSeconds + BANGKOK_OFFSET_SECONDS) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

module.exports = {
  parseBangkok,
  nowSeconds,
  discordTime,
  formatBangkok,
  toBangkokInput,
  BANGKOK_OFFSET_SECONDS,
};

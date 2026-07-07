'use strict';

// Courier options offered when sending a tracking number. Single source of truth
// for the embed (color + tracking link) and the dashboard selector/preview.
// Tracking URLs pre-fill the buyer's number on the carrier's site; tweak if a
// carrier changes its URL format.
const CARRIERS = {
  thailandpost: {
    id: 'thailandpost',
    name: 'ไปรษณีย์ไทย',
    color: 0xe3000f, // brand red (Discord embed int)
    hex: '#e3000f',
    trackUrl: (no) => `https://track.thailandpost.co.th/?trackNumber=${encodeURIComponent(no)}`,
  },
  flash: {
    id: 'flash',
    name: 'Flash Express',
    color: 0xfdd400, // brand yellow
    hex: '#fdd400',
    trackUrl: (no) => `https://www.flashexpress.com/tracking/?se=${encodeURIComponent(no)}`,
  },
};

function getCarrier(id) {
  return (id && CARRIERS[id]) || null;
}

// Compact list for the browser (no functions).
function publicList() {
  return Object.values(CARRIERS).map((c) => ({ id: c.id, name: c.name, hex: c.hex }));
}

module.exports = { CARRIERS, getCarrier, publicList };

'use strict';

// Single source of truth for component custom_ids. Keep them well under the
// 100-char limit. Format: namespace:detail... split on ':'.
//
//   item:{itemId}:reserve | check | cancel     (public buyer buttons)
//   tk:{itemId}:confirm | release              (admin buttons in ticket channel)
//   setup:edit:{slot}                          (open item-edit modal)
//   setup:schedule | preview | publish | cleanup
//   m:item:{itemId}                            (item-edit modal submit)
//   m:schedule:{dropId}                        (schedule modal submit)
//   m:ship:{itemId}                            (shipping-note modal submit at confirm)

const ids = {
  itemReserve: (itemId) => `item:${itemId}:reserve`,
  itemCheck: (itemId) => `item:${itemId}:check`,
  itemCancel: (itemId) => `item:${itemId}:cancel`,

  tkConfirm: (itemId) => `tk:${itemId}:confirm`,
  tkRelease: (itemId) => `tk:${itemId}:release`,

  setupEdit: (slot) => `setup:edit:${slot}`,
  setupSchedule: 'setup:schedule',
  setupPreview: 'setup:preview',
  setupPublish: 'setup:publish',
  setupCleanup: 'setup:cleanup',

  modalItem: (itemId) => `m:item:${itemId}`,
  modalSchedule: (dropId) => `m:schedule:${dropId}`,
  modalShip: (itemId) => `m:ship:${itemId}`,
};

// Parse a custom_id into { ns, parts:[...] }.
function parse(customId) {
  const parts = customId.split(':');
  return { ns: parts[0], parts };
}

module.exports = { ids, parse };

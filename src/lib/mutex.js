'use strict';

// Per-key async mutex. Serializes the read-decide-act windows (which span
// awaits: DB read -> Discord API calls) for a single key (here: an item id).
// Because the bot is a single process and Node is single-threaded, this is
// sufficient to prevent two simultaneous "am I #1?" decisions from interleaving.
//
// Usage:
//   const result = await mutex.run(itemId, async () => { ...critical section... });
//
// Each key maintains a promise chain; new tasks await the tail of the chain.
class KeyedMutex {
  constructor() {
    /** @type {Map<string|number, Promise<unknown>>} */
    this._tails = new Map();
  }

  run(key, task) {
    const prev = this._tails.get(key) || Promise.resolve();

    // The next tail resolves after `task` settles, regardless of outcome, so a
    // rejected task doesn't permanently wedge the chain.
    const run = prev.then(() => task());
    const tail = run.then(
      () => {},
      () => {},
    );

    this._tails.set(key, tail);

    // Garbage-collect the map entry once this is the last task in the chain.
    tail.finally(() => {
      if (this._tails.get(key) === tail) {
        this._tails.delete(key);
      }
    });

    return run;
  }
}

module.exports = new KeyedMutex();

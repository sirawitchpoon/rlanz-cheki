'use strict';

// Tiny leveled logger. PM2 already timestamps lines (time: true), but we add our
// own ISO stamp so logs are readable when run directly too.
function stamp() {
  return new Date().toISOString();
}

function fmt(level, args) {
  return [`${stamp()} [${level}]`, ...args];
}

const logger = {
  info: (...args) => console.log(...fmt('INFO', args)),
  warn: (...args) => console.warn(...fmt('WARN', args)),
  error: (...args) => console.error(...fmt('ERROR', args)),
  debug: (...args) => {
    if (process.env.DEBUG) console.log(...fmt('DEBUG', args));
  },
};

module.exports = logger;

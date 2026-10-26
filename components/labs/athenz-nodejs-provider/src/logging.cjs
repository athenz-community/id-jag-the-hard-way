'use strict';

// Both upstream packages share this Winston instance. Some upstream messages
// contain token strings, so sanitize them before a transport writes anything.
const logger = require('@athenz/zpe-client/logger');

function redact(message) {
  return String(message)
    .replace(/(token=).*?(?= : |$)/gi, '$1[redacted]')
    .replace(/(RoleToken created: |Constructing RoleToken with input string: ).*/g, '$1[redacted]')
    .replace(/(signature:).*/g, '$1[redacted]');
}

function configureLogging(write) {
  const transport = new logger.transports.Console({ stderrLevels: ['error', 'warn', 'info'] });
  if (write) {
    // Test-only capture of already sanitized messages, with no raw token output.
    transport.log = (info, done) => {
      write(info[Symbol.for('message')]);
      done();
    };
  }
  logger.configure({
    level: 'info',
    format: logger.format.printf(({ level, message }) => `${level}: ${redact(message)}`),
    transports: [transport],
  });
  return logger;
}

module.exports = { configureLogging, redact };

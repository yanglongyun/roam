const sessions = require('../core/sessions');

async function close(terminalId) {
    await sessions.close(terminalId, { ensureOne: true });
}

module.exports = { close };

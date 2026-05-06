const sessions = require('../core/sessions');
const ws = require('../../../server/ws');

async function create(options = {}) {
    const terminal = await sessions.create(options);
    ws.broadcast('terminal.activated', { terminalId: terminal.id });
    return terminal;
}

module.exports = { create };

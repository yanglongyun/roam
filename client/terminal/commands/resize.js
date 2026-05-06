const sessions = require('../core/sessions');

function resize(terminalId, cols, rows) {
    sessions.resize(terminalId, cols, rows);
}

module.exports = { resize };

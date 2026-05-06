const sessions = require('../core/sessions');

function activate(terminalId) {
    sessions.activate(terminalId);
}

module.exports = { activate };

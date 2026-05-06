const sessions = require('../core/sessions');

function input(terminalId, text) {
    sessions.write(terminalId, text);
}

module.exports = { input };

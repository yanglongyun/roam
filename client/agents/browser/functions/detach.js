const { runCommand } = require('./request');

module.exports = async function detach({ timeoutSeconds = 15 } = {}) {
    return runCommand('detach', {}, timeoutSeconds);
};

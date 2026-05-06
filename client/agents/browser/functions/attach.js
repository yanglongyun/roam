const { runCommand } = require('./request');

module.exports = async function attach({ timeoutSeconds = 15 } = {}) {
    return runCommand('attach', {}, timeoutSeconds);
};

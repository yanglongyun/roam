const { runCommand } = require('./request');

module.exports = async function navigate({ url, timeoutSeconds = 15 } = {}) {
    if (!url) throw new Error('缺少 url');
    return runCommand('navigate', { url }, timeoutSeconds);
};

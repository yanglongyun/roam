const { runCommand } = require('./request');

module.exports = async function openTab({ url, timeoutSeconds = 15 } = {}) {
    if (!url) throw new Error('缺少 url');
    return runCommand('open-tab', { url }, timeoutSeconds);
};

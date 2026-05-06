const { runCommand } = require('./request');

module.exports = async function evaluate({ code, timeoutSeconds = 15 } = {}) {
    const expression = String(code || '').trim();
    if (!expression) throw new Error('缺少 code');
    await runCommand('attach', {}, timeoutSeconds);
    return runCommand('evaluate', { expression, returnByValue: true }, timeoutSeconds);
};

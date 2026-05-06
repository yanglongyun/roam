const ws = require('./ws');
const guard = require('../apps/guard');
const terminal = require('../apps/terminal');
const files = require('../apps/files');
const screen = require('../apps/screen');
const agents = require('../agents');
const claudeCode = require('../apps/claude-code');

let onDevicesChanged = () => {};

function bindOnDevicesChanged(fn) {
    onDevicesChanged = fn;
}

async function dispatch(message) {
    const t = message.type || '';

    if (t === 'connection.ping') {
        ws.send({ type: 'connection.pong', to: 'server', data: {} });
        return;
    }
    if (t === 'connection.devices') {
        onDevicesChanged(message.data?.devices);
        return;
    }
    if (t === 'connection.ready') return;

    if (t.startsWith('auth.')) {
        if (await guard.handle(message)) return;
    }
    if (t.startsWith('terminal.') || t.startsWith('data.') || t.startsWith('system.')) {
        if (await terminal.handle(message)) return;
    }
    if (t.startsWith('fs.')) {
        if (await files.handle(message)) return;
    }
    if (t.startsWith('screen.')) {
        if (await screen.handle(message)) return;
    }
    if (t.startsWith('agent.')) {
        if (await agents.handle(message)) return;
    }
    if (t.startsWith('cc.')) {
        if (await claudeCode.handle(message)) return;
    }

    console.log('未识别的消息类型:', t);
}

module.exports = { dispatch, bindOnDevicesChanged };

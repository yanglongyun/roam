const ws = require('./ws');
const guard = require('../guard');
const terminal = require('../terminal');
const files = require('../files');
const agent = require('../agent');
const screen = require('../screen');
const claudeCode = require('../claude-code');

// onDevicesChanged 由 index.js 注入（web 上线时推各 feature 的初始快照）
let onDevicesChanged = () => {};

function bindOnDevicesChanged(fn) {
    onDevicesChanged = fn;
}

async function dispatch(message) {
    const t = message.type || '';

    // 基础连接层
    if (t === 'connection.ping') {
        ws.send({ type: 'connection.pong', to: 'server', data: {} });
        return;
    }
    if (t === 'connection.devices') {
        onDevicesChanged(message.data?.devices);
        return;
    }
    if (t === 'connection.ready') return;

    // 按前缀分派到各 feature
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
        if (await agent.handle(message)) return;
    }
    if (t.startsWith('cc.')) {
        if (await claudeCode.handle(message)) return;
    }

    console.log('未知消息类型:', t);
}

module.exports = { dispatch, bindOnDevicesChanged };

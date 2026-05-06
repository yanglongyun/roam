const WebSocket = require('ws');
const { SERVER_URL, WEB_URL, SESSION_PASSWORD, DEBUG } = require('../core/env');
const { generateSessionId } = require('../core/ids');
const browserExtension = require('./browser-extension');

const state = {
    ws: null,
    sessionId: generateSessionId(),
    onMessage: null,
    onOpen: null,
    reconnectTimer: null,
};

function send(message) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(message));
    }
}

function sendToClient(clientId, type, data) {
    if (!clientId) return;
    send({ type, to: `web:${clientId}`, data });
}

function broadcast(type, data) {
    send({ type, to: 'web', data });
}

function printAccessInfo() {
    const webUrl = `${WEB_URL}/guard?session=${state.sessionId}`;
    console.log('');
    console.log('✅ Meem 已连接');
    console.log('🔗 远程访问入口');
    console.log(`   ${webUrl}`);

    if (SESSION_PASSWORD) {
        console.log('');
        console.log('🔐 访问校验密码');
        console.log(`   ${SESSION_PASSWORD}`);
    }

    console.log('');
    console.log('🌍 本地浏览器连接服务');
    console.log(`   服务地址: ${browserExtension.serviceUrl}`);
    console.log('   说明: 用于连接 Meem 浏览器扩展，并转发当前浏览器标签页能力');

    console.log('');
    console.log('📘 使用说明');
    console.log('   1. 在任意设备浏览器中打开上面的访问入口');
    console.log('   2. 如已设置访问密码，先输入密码再进入');
    console.log('   3. 首次进入后即可使用终端、文件、屏幕、Agents 和浏览器能力');
    console.log('');
}

function connect() {
    const url = `${SERVER_URL}/ws?session=${state.sessionId}&device=desktop`;
    state.ws = new WebSocket(url);

    state.ws.on('open', () => {
        printAccessInfo();
        state.onOpen?.();
    });

    state.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (err) {
            console.error('❌ 消息解析失败:', err);
            return;
        }
        if (DEBUG) console.log(`[debug] recv ${msg.type}`, JSON.stringify(msg).slice(0, 200));
        state.onMessage?.(msg);
    });

    state.ws.on('close', () => {
        console.log('⚠️ Meem 连接已断开，3 秒后自动重连...');
        state.reconnectTimer = setTimeout(connect, 3000);
    });

    state.ws.on('error', (err) => {
        console.error('❌ 网络连接异常:', err.message);
    });
}

function init({ onOpen, onMessage }) {
    state.onOpen = onOpen;
    state.onMessage = onMessage;
    connect();
}

function close() {
    clearTimeout(state.reconnectTimer);
    state.ws?.close();
}

function getSessionId() {
    return state.sessionId;
}

module.exports = {
    init,
    send,
    sendToClient,
    broadcast,
    close,
    getSessionId,
};

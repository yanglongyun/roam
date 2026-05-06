const WebSocket = require('ws');
const { SERVER_URL, WEB_URL, SESSION_PASSWORD, DEBUG } = require('./env');
const { generateSessionId } = require('./ids');

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

function connect() {
    const url = `${SERVER_URL}/ws?session=${state.sessionId}&device=desktop`;
    state.ws = new WebSocket(url);

    state.ws.on('open', () => {
        const webUrl = `${WEB_URL}/guard?session=${state.sessionId}`;
        console.log('🔗 访问链接:');
        console.log(`   ${webUrl}`);
        if (SESSION_PASSWORD) console.log(`🔐 访问密码: ${SESSION_PASSWORD}`);
        state.onOpen?.();
    });

    state.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (err) {
            console.error('解析消息失败:', err);
            return;
        }
        if (DEBUG) console.log(`[debug] recv ${msg.type}`, JSON.stringify(msg).slice(0, 200));
        state.onMessage?.(msg);
    });

    state.ws.on('close', () => {
        console.log('❌ 与服务器断开连接，3秒后重连...');
        state.reconnectTimer = setTimeout(connect, 3000);
    });

    state.ws.on('error', (err) => {
        console.error('WebSocket错误:', err.message);
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

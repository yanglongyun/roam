import WebSocket from 'ws';
import { SERVER_URL, WEB_URL, SESSION_ID, SESSION_PASSWORD, DEBUG } from '../core/env.js';
import { generateSessionId } from '../core/ids.js';

const state = {
    ws: null,
    sessionId: SESSION_ID || generateSessionId(),
    onMessage: null,
    onOpen: null,
    reconnectTimer: null,
    hasPrintedAccessInfo: false,
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
    const params = new URLSearchParams({ session: state.sessionId });
    const webUrl = `${WEB_URL}/guard?${params.toString()}`;
    console.log('');
    console.log('✅ Roam 已连接');
    console.log('🔗 远程访问入口');
    console.log(`   ${webUrl}`);

    if (SESSION_PASSWORD) {
        console.log('');
        console.log('🔐 访问校验密码');
        console.log(`   ${SESSION_PASSWORD}`);
    }

    console.log('');
    console.log('📘 使用说明');
    console.log('   1. 在任意设备浏览器中打开上面的访问入口');
    console.log('   2. 如已设置访问密码，先输入密码再进入');
    console.log('   3. 首次进入后即可使用终端、文件、屏幕能力');
    console.log('');
}

function connect() {
    const params = new URLSearchParams({ session: state.sessionId, device: 'desktop' });
    const url = `${SERVER_URL}/ws?${params.toString()}`;
    state.ws = new WebSocket(url);

    state.ws.on('open', () => {
        if (state.hasPrintedAccessInfo) {
            console.log('✅ Roam 已重连');
        } else {
            printAccessInfo();
            state.hasPrintedAccessInfo = true;
        }
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
        console.log('⚠️ Roam 连接已断开，3 秒后自动重连...');
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

export { init, send, sendToClient, broadcast, close, getSessionId };
export default {
    init,
    send,
    sendToClient,
    broadcast,
    close,
    getSessionId,
};

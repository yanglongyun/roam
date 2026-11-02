import WebSocket from 'ws';
import { SERVER_URL, WEB_URL, DEVICE_TOKEN, DEBUG } from './core/env.js';
import { deviceId } from './core/device.js';

const state = {
    ws: null,
    deviceId: deviceId(),
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
    console.log('');
    console.log('✅ Roam 已连接');
    console.log(`🪪 设备 id：${state.deviceId}`);
    console.log('🔗 远程访问入口');
    console.log(`   ${WEB_URL}/`);
    console.log('');
    console.log('📘 使用说明');
    console.log('   1. 在任意设备浏览器中打开上面的访问入口');
    console.log('   2. 输入访问密码（Worker 的 ACCESS_PASSWORD）');
    console.log('   3. 在右上角选择这台设备，即可使用对话、终端、文件、屏幕能力');
    console.log('');
}

function connect() {
    const params = new URLSearchParams({ device: 'desktop', device_id: state.deviceId });
    const url = `${SERVER_URL}/ws?${params.toString()}`;
    state.ws = new WebSocket(url, { headers: { authorization: `Bearer ${DEVICE_TOKEN}` } });

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

    state.ws.on('close', (code) => {
        if (code === 4002) {
            console.log('⚠️ 这台设备在别处又连上了一次，本连接被替换；3 秒后重连...');
        } else {
            console.log('⚠️ Roam 连接已断开，3 秒后自动重连...');
        }
        state.reconnectTimer = setTimeout(connect, 3000);
    });

    state.ws.on('error', (err) => {
        console.error('❌ 网络连接异常:', err.message);
        if (/\b401\b/.test(err.message)) {
            console.error('   Worker 拒绝了这台电脑：检查 DEVICE_TOKEN 是否和 Worker 的 secret 一致');
        }
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

function getDeviceId() {
    return state.deviceId;
}

export { init, send, sendToClient, broadcast, close, getDeviceId };
export default {
    init,
    send,
    sendToClient,
    broadcast,
    close,
    getDeviceId,
};

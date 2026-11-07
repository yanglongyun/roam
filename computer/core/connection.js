import WebSocket from 'ws';

// 只管理一个 Computer 的云端连接；配置和设备身份由入口传入。
export function createConnection({ serverUrl, webUrl, token, id, debug = false, log = console.log, error = console.error }) {
    let socket = null, reconnectTimer = null, stopped = true, connectedBefore = false;
    let callbacks = {};

    function send(message) {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    }
    function sendToClient(clientId, type, data) { if (clientId) send({ type, to: `web:${clientId}`, data }); }
    function broadcast(type, data) { send({ type, to: 'web', data }); }

    function printAccessInfo() {
        log(''); log('✅ Roam 已连接'); log(`🪪 设备 id：${id}`);
        log('🔗 远程访问入口'); log(`   ${webUrl}/`); log('');
        log('📘 使用说明');
        log('   1. 在任意设备浏览器中打开上面的访问入口');
        log('   2. 输入访问密码');
        log('   3. 在应用面板打开助理、任务、终端、文件或屏幕；设备操作页可选择这台电脑');
        log('');
    }

    function connect() {
        if (stopped) return;
        reconnectTimer = null;
        const params = new URLSearchParams({ device: 'desktop', device_id: id });
        const current = new WebSocket(`${serverUrl}/ws?${params}`, { headers: { authorization: `Bearer ${token}` } });
        socket = current;
        current.on('open', () => {
            if (current !== socket || stopped) return;
            if (connectedBefore) log('✅ Roam 已重连');
            else { printAccessInfo(); connectedBefore = true; }
            callbacks.onOpen?.();
        });
        current.on('message', (raw) => {
            if (current !== socket || stopped) return;
            let msg;
            try { msg = JSON.parse(raw); } catch (err) { error('❌ 消息解析失败:', err); return; }
            if (debug) log(`[debug] recv ${msg.type}`, JSON.stringify(msg).slice(0, 200));
            callbacks.onMessage?.(msg);
        });
        current.on('close', (code) => {
            if (current !== socket) return;
            socket = null;
            callbacks.onClose?.();
            if (stopped) return;
            if (code === 4002) {
                stopped = true;
                log('⚠️ 同一设备的另一实例已连接，当前实例已停止自动重连。请检查重复运行的 Computer。');
                return;
            }
            log('⚠️ Roam 连接已断开，3 秒后自动重连...');
            reconnectTimer = setTimeout(connect, 3000);
        });
        current.on('error', (err) => {
            if (current !== socket || stopped) return;
            error('❌ 网络连接异常:', err.message);
            if (/\b401\b/.test(err.message)) error('   Worker 拒绝了这台电脑：检查 DEVICE_TOKEN 是否和 Worker 的 secret 一致');
        });
    }

    function init(options) {
        if (socket || reconnectTimer) throw new Error('Computer 的云端连接已经启动');
        callbacks = options;
        stopped = false;
        connect();
    }
    function close() {
        stopped = true;
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        socket?.close();
    }
    return { init, send, sendToClient, broadcast, close, getDeviceId: () => id };
}

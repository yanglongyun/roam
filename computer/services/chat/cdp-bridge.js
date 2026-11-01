// 本地 CDP 桥：只监听 127.0.0.1，等 browser-use 扩展连上来。
// 模型经 browser_cdp 工具 → 这里 → 扩展(chrome.debugger) → 回结果。全程走 loopback，不经 worker。
// 线协议（与 extension/background.js 一致）：
//   发 {id, method:'cdp', params:{ method, params, tabId? }}
//   收 {id, ok:true, result} / {id, ok:false, error}
//   扩展还会推 {type:'event'|'hello'|'pong'}，这里忽略（无人订阅）。
import { WebSocketServer } from 'ws';
import ws from '../../ws.js';
import { BROWSER_BRIDGE_PORT } from '../../core/env.js';

const PORT = Number(BROWSER_BRIDGE_PORT) || 9510;
const REQUEST_TIMEOUT = 30000;

let wss = null;
let ext = null;            // 当前连接的扩展 socket（单连接独占）
let seq = 0;
const pending = new Map(); // id -> { resolve, reject, timer }

function start() {
    if (wss) return;
    try {
        wss = new WebSocketServer({ host: '127.0.0.1', port: PORT, path: '/cdp' });
    } catch (e) {
        console.error('🧩 CDP 桥启动失败:', e.message);
        return;
    }
    wss.on('error', (e) => console.error('🧩 CDP 桥错误:', e.message));
    wss.on('connection', (socket, req) => {
        // token 校验：?token=<session id>，挡掉本机其它进程乱连
        let token = '';
        try { token = new URL(req.url, 'http://127.0.0.1').searchParams.get('token') || ''; } catch {}
        if (token !== ws.getSessionId()) { try { socket.close(4001, 'bad token'); } catch {} return; }

        if (ext && ext !== socket) { try { ext.close(); } catch {} }
        ext = socket;
        console.log('🧩 browser-use 扩展已连接');

        socket.on('message', (raw) => {
            let msg; try { msg = JSON.parse(raw); } catch { return; }
            if (msg.type) return; // event/hello/pong 等，忽略
            if (msg.id == null) return;
            const p = pending.get(msg.id);
            if (!p) return;
            pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.ok) p.resolve(msg.result);
            else p.reject(new Error(msg.error || 'CDP 执行失败'));
        });
        socket.on('close', () => { if (ext === socket) ext = null; console.log('🧩 browser-use 扩展已断开'); });
        socket.on('error', () => {});
    });

    console.log(`🧩 浏览器 CDP 桥就绪：ws://127.0.0.1:${PORT}/cdp?token=${ws.getSessionId()}`);
    console.log('   在 browser-use 扩展弹窗里填入上面这个地址，即可让 AI 驱动本机 Chrome。');
}

function connected() {
    return Boolean(ext && ext.readyState === 1 /* OPEN */);
}

// 发一条 CDP 指令，等扩展回结果。method 如 'Page.navigate' / 'Runtime.evaluate'。
function cdp(method, params = {}, tabId) {
    if (!connected()) {
        return Promise.reject(new Error('浏览器扩展未连接。请在 Chrome 安装/开启 browser-use 扩展，并在扩展里填入 CDP 桥地址（见 computer 启动日志）。'));
    }
    return new Promise((resolve, reject) => {
        const id = `b${++seq}`;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP 请求超时（30s）')); }, REQUEST_TIMEOUT);
        pending.set(id, { resolve, reject, timer });
        const payload = { id, method: 'cdp', params: { method, params: params || {} } };
        if (tabId != null) payload.params.tabId = tabId;
        try { ext.send(JSON.stringify(payload)); }
        catch (e) { pending.delete(id); clearTimeout(timer); reject(e); }
    });
}

export { start, cdp, connected };
export default { start, cdp, connected };

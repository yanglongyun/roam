// 助理（agentic 的 agent）接到 Roam 上。
// 网页的操作走 agent.request（经 Worker 中继），结果回给发起的网页端：agent.result { reqId, ok, data | status + error }。
// Agent 的九种事件补上 session_id 后经 agent.event 推给所有网页端，只往下推。
import path from 'node:path';
import ws from '../../ws.js';
import { paths, loadConfig } from './config.js';
import openDB from './db.js';
import { startBrowser } from './browser/bridge.js';
import { registerHost } from './browser/register-host.js';
import * as sessions from './ops/sessions.js';
import * as messages from './ops/messages.js';
import * as images from './ops/images.js';
import * as config from './ops/config.js';

const ops = {
    'sessions.list': sessions.list,
    'sessions.create': sessions.create,
    'sessions.open': sessions.open,
    'sessions.patch': sessions.patch,
    'sessions.pins': sessions.pins,
    'sessions.delete': sessions.remove,
    'messages.list': messages.list,
    'messages.send': messages.send,
    'run.stop': messages.stop,
    'images.upload': images.upload,
    'images.get': images.get,
    'config.get': config.get,
    'config.put': config.put,
    status: config.status,
};

let context = null;

function start() {
    const p = paths();
    context = {
        paths: p,
        config: loadConfig(p),
        db: openDB(p.db),
        // 正在运行的回复：会话 ID → { controller, done, text, reasoning }
        runs: new Map(),
        browser: startBrowser({ address: p.browser }),
        publish(sessionId, event) {
            ws.broadcast('agent.event', { ...event, session_id: sessionId });
        },
    };
    try {
        const browsers = registerHost({ dir: path.join(p.root, 'native-host'), socket: p.browser });
        if (browsers.length) console.log(`🧩 浏览器插件宿主已登记：${browsers.join('、')}`);
    } catch (error) {
        console.error('🧩 浏览器插件宿主登记失败：', error.message);
    }
}

async function handle(message) {
    if (message.type !== 'agent.request') return false;
    const { reqId, op, args } = message.data || {};
    const clientId = message.meta?.clientId || null;
    const reply = (data) => {
        if (clientId) ws.sendToClient(clientId, 'agent.result', { reqId, ...data });
        else ws.broadcast('agent.result', { reqId, ...data });
    };
    const fn = ops[op];
    if (!fn) {
        reply({ ok: false, status: 404, error: `未知操作：${op}` });
        return true;
    }
    try {
        reply({ ok: true, data: await fn(context, args || {}) });
    } catch (error) {
        if (!error.status) console.error(`助理操作失败 [${op}]:`, error.message || error);
        reply({ ok: false, status: error.status || 500, error: error.message || String(error) });
    }
    return true;
}

// 退出前停掉正在运行的回复，让它们补写工具结果、推送 done。
async function shutdown() {
    if (!context) return;
    const pending = [];
    for (const run of context.runs.values()) {
        run.controller.abort(new DOMException('已停止', 'AbortError'));
        if (run.done) pending.push(run.done);
    }
    await Promise.allSettled(pending);
    context.browser.close();
    context.db.close();
    context = null;
}

export { start, handle, shutdown };
export default { start, handle, shutdown };

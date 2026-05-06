const ws = require('../core/ws');
const config = require('./core/config');
const session = require('./core/session');
const handler = require('./handler');

// 数据库行 → 网络消息：原封不动摊开成 { _id, _meta, role, content, tool_calls, tool_call_id }
function serializeRow(row) {
    let m = {};
    try { m = JSON.parse(row.message); } catch {}
    const meta = row.meta ? (() => { try { return JSON.parse(row.meta); } catch { return {}; } })() : {};
    return { _id: row.id, _meta: meta, ...m };
}

function sendConfig(target = 'web') {
    const cfg = config.get();
    const data = {
        configured: Boolean(cfg.apiUrl && cfg.apiKey && cfg.model),
        provider: cfg.provider || '',
        model: cfg.model || '',
        apiUrl: cfg.apiUrl || '',
        apiKeyMasked: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}...${cfg.apiKey.slice(-4)}` : '',
    };
    if (target === 'web') ws.broadcast('agent.config', data);
    else ws.send({ type: 'agent.config', to: target, data });
}

function sendSessions(target = 'web') {
    const data = { sessions: session.listAll(), activeId: session.getId() };
    if (target === 'web') ws.broadcast('agent.sessions', data);
    else ws.send({ type: 'agent.sessions', to: target, data });
}

function sendSession(target = 'web') {
    const data = session.getMeta();
    if (target === 'web') ws.broadcast('agent.session', data);
    else ws.send({ type: 'agent.session', to: target, data });
}

function sendHistory(target = 'web', { offset = 0, limit = 50 } = {}) {
    const { rows, total, hasMore } = session.loadRowsPage({ offset, limit });
    const data = {
        session: session.getMeta(),
        messages: rows.map(serializeRow),
        offset,
        limit,
        total,
        hasMore,
    };
    if (target === 'web') ws.broadcast('agent.history', data);
    else ws.send({ type: 'agent.history', to: target, data });
}

async function handle(message) {
    const clientId = message.meta?.clientId || message.data?.clientId || null;
    const t = message.type;

    try {
        switch (t) {
            case 'agent.chat':
                if (!clientId) throw new Error('缺少 clientId');
                await handler.chat(clientId, message.data?.message);
                return true;

            case 'agent.set_config':
                config.set(message.data || {});
                sendConfig('web');
                if (clientId) ws.sendToClient(clientId, 'agent.config_saved', { ok: true });
                return true;

            case 'agent.abort':
                if (!clientId) throw new Error('缺少 clientId');
                handler.abort(clientId);
                ws.sendToClient(clientId, 'agent.error', { error: '执行已取消' });
                return true;

            case 'agent.new_session': {
                handler.abortAll();
                session.createNew();
                sendSession('web');
                sendSessions('web');
                sendHistory('web');
                return true;
            }

            case 'agent.switch_session': {
                const id = String(message.data?.id || '');
                if (!id) throw new Error('缺少 id');
                handler.abortAll();
                session.setActive(id);
                sendSession('web');
                sendSessions('web');
                sendHistory('web');
                return true;
            }

            case 'agent.delete_session': {
                const id = String(message.data?.id || '');
                if (!id) throw new Error('缺少 id');
                const wasActive = session.getId() === id;
                if (wasActive) handler.abortAll();
                session.deleteSession(id);
                if (wasActive) {
                    sendSession('web');
                    sendHistory('web');
                }
                sendSessions('web');
                return true;
            }

            case 'agent.load_history': {
                const offset = Number(message.data?.offset) || 0;
                const limit = Math.min(200, Math.max(1, Number(message.data?.limit) || 50));
                if (clientId) sendHistory(`web:${clientId}`, { offset, limit });
                else sendHistory('web', { offset, limit });
                return true;
            }

            case 'agent.list_sessions':
                if (clientId) sendSessions(`web:${clientId}`);
                else sendSessions('web');
                return true;

            default:
                return false;
        }
    } catch (err) {
        if (clientId) {
            ws.sendToClient(clientId, 'agent.error', { error: err.message || String(err) });
            ws.sendToClient(clientId, 'agent.run_state', { running: false });
        }
        return true;
    }
}

module.exports = {
    handle,
    sendConfig,
    sendSessions,
    sendSession,
    sendHistory,
    ensureSession: session.ensureActive,
};

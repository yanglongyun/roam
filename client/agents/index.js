const ws = require('../server/ws');
const config = require('./config');
const session = require('./session');
const { runAgent } = require('./runtime');
const { getProviderCatalog } = require('../llm/providers');

const runs = new Map();

function serializeRow(row) {
    let message = {};
    try { message = JSON.parse(row.message); } catch {}
    const meta = row.meta ? (() => { try { return JSON.parse(row.meta); } catch { return {}; } })() : {};
    return { _id: row.id, _meta: meta, ...message };
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

function sendProviders(target = 'web') {
    const data = getProviderCatalog();
    if (target === 'web') ws.broadcast('agent.providers', data);
    else ws.send({ type: 'agent.providers', to: target, data });
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

function abort(clientId) {
    const active = runs.get(clientId);
    if (!active) return false;
    active.abortController.abort();
    runs.delete(clientId);
    return true;
}

function abortAll() {
    for (const [, active] of runs) {
        active.abortController.abort();
    }
    runs.clear();
}

async function chat(clientId, input) {
    const cfg = config.get();
    if (!cfg.apiUrl || !cfg.apiKey || !cfg.model) {
        throw new Error('Agents 未配置：请在设置中填写 API URL / API Key / Model');
    }

    abort(clientId);

    const history = session.loadAllMessages();
    const trimmed = String(input || '').trim();
    const isFirst = history.length === 0;
    const userMsg = { role: 'user', content: trimmed };
    session.appendMessage(userMsg);

    if (isFirst) {
        session.updateTitleFromUserMessage(trimmed);
        sendSession('web');
        sendSessions('web');
    }

    const abortController = new AbortController();
    runs.set(clientId, { abortController });
    ws.sendToClient(clientId, 'agent.run_state', { running: true });

    try {
        return await runAgent({
            agentName: 'main',
            config: cfg,
            messages: [...history, userMsg],
            signal: abortController.signal,
            onDelta: (delta) => ws.sendToClient(clientId, 'agent.delta', { delta }),
            hooks: {
                onAssistantToolCalls(assistantMsg) {
                    session.appendMessage(assistantMsg);
                },
                onToolCall(toolCall) {
                    ws.sendToClient(clientId, 'agent.tool_call', { toolCall });
                },
                onToolResult(toolCall, resultText, toolMsg) {
                    session.appendMessage(toolMsg);
                    ws.sendToClient(clientId, 'agent.tool_result', {
                        toolCallId: toolCall.id,
                        content: resultText,
                    });
                },
                onFinalMessage(finalMsg, usage) {
                    session.appendMessage(finalMsg);
                    ws.sendToClient(clientId, 'agent.done', { content: finalMsg.content, usage });
                },
            },
        });
    } finally {
        if (runs.get(clientId)?.abortController === abortController) {
            runs.delete(clientId);
        }
        ws.sendToClient(clientId, 'agent.run_state', { running: false });
    }
}

async function handle(message) {
    const clientId = message.meta?.clientId || message.data?.clientId || null;
    const type = message.type;

    try {
        switch (type) {
            case 'agent.chat':
                if (!clientId) throw new Error('缺少 clientId');
                await chat(clientId, message.data?.message);
                return true;
            case 'agent.set_config':
                config.set(message.data || {});
                sendConfig('web');
                if (clientId) ws.sendToClient(clientId, 'agent.config_saved', { ok: true });
                return true;
            case 'agent.get_providers':
                if (clientId) sendProviders(`web:${clientId}`);
                else sendProviders('web');
                return true;
            case 'agent.abort':
                if (!clientId) throw new Error('缺少 clientId');
                abort(clientId);
                ws.sendToClient(clientId, 'agent.error', { error: '执行已取消' });
                return true;
            case 'agent.new_session':
                abortAll();
                session.createNew();
                sendSession('web');
                sendSessions('web');
                sendHistory('web');
                return true;
            case 'agent.switch_session': {
                const id = String(message.data?.id || '');
                if (!id) throw new Error('缺少 id');
                abortAll();
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
                if (wasActive) abortAll();
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
    } catch (error) {
        if (clientId) {
            ws.sendToClient(clientId, 'agent.error', { error: error.message || String(error) });
            ws.sendToClient(clientId, 'agent.run_state', { running: false });
        }
        return true;
    }
}

module.exports = {
    handle,
    sendConfig,
    sendProviders,
    sendSessions,
    sendSession,
    sendHistory,
    ensureSession: session.ensureActive,
    abort,
    abortAll,
};

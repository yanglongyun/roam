const ws = require('../core/ws');
const { getClaudeStatus } = require('./core/status');
const session = require('./core/session');
const db = require('./core/db');
const { runClaude } = require('./core/runner');

const runs = new Map();

function sendStatus(target = 'web') {
    getClaudeStatus().then((status) => {
        if (target === 'web') ws.broadcast('cc.status', status);
        else ws.send({ type: 'cc.status', to: target, data: status });
    });
}

function sendSessions(target = 'web') {
    const data = { sessions: session.listSessions() };
    if (target === 'web') ws.broadcast('cc.sessions', data);
    else ws.send({ type: 'cc.sessions', to: target, data });
}

function sendMessages(target, sessionId) {
    const data = session.getMessages(sessionId);
    if (target === 'web') ws.broadcast('cc.messages', data);
    else ws.send({ type: 'cc.messages', to: target, data: { ...data, sessionId } });
}

async function handle(message) {
    const clientId = message.meta?.clientId || null;
    const t = message.type;
    const data = message.data || {};

    try {
        switch (t) {
            case 'cc.status':
                sendStatus(clientId ? `web:${clientId}` : 'web');
                return true;

            case 'cc.list_sessions':
                sendSessions(clientId ? `web:${clientId}` : 'web');
                return true;

            case 'cc.create_session': {
                const result = session.createSession({
                    cwd: data.cwd,
                    permissionMode: data.permissionMode,
                });
                if (result?.error) {
                    if (clientId) ws.sendToClient(clientId, 'cc.error', { error: result.error });
                    return true;
                }
                if (clientId) ws.sendToClient(clientId, 'cc.session_created', result);
                sendSessions('web');
                return true;
            }

            case 'cc.delete_session': {
                const sid = String(data.sessionId || '');
                if (!sid) throw new Error('sessionId required');
                abortRun(sid);
                session.deleteSession(sid);
                sendSessions('web');
                return true;
            }

            case 'cc.load_messages': {
                const sid = String(data.sessionId || '');
                if (!sid) throw new Error('sessionId required');
                sendMessages(clientId ? `web:${clientId}` : 'web', sid);
                return true;
            }

            case 'cc.send': {
                if (!clientId) throw new Error('missing clientId');
                const sid = String(data.sessionId || '');
                const prompt = String(data.message || '').trim();
                const permMode = data.permissionMode || 'default';
                if (!sid || !prompt) throw new Error('sessionId and message required');
                await handleSend(clientId, sid, prompt, permMode);
                return true;
            }

            case 'cc.abort': {
                const sid = String(data.sessionId || '');
                if (sid) abortRun(sid);
                if (clientId) ws.sendToClient(clientId, 'cc.done', {});
                return true;
            }

            default:
                return false;
        }
    } catch (err) {
        if (clientId) ws.sendToClient(clientId, 'cc.error', { error: err.message || String(err) });
        return true;
    }
}

async function handleSend(clientId, sessionId, prompt, permissionMode) {
    const sess = session.getSession(sessionId);
    if (!sess) throw new Error('conversation not found');
    const ctx = session.getContext(sessionId);
    if (!ctx) throw new Error('conversation not found');

    db.updatePermissionMode(ctx.id, permissionMode);

    db.appendEvent(ctx.id, 'user_turn', {
        type: 'user',
        message: { role: 'user', content: prompt },
    });
    db.setTitleIfEmpty(ctx.id, prompt.slice(0, 80));

    ws.sendToClient(clientId, 'cc.run_state', { running: true, sessionId });

    let eventCount = 1;
    const child = runClaude({
        sessionId: sess.sessionId,
        started: ctx.started,
        cwd: sess.cwd,
        permissionMode,
        prompt,
        onEvent: (evt) => {
            try { db.appendEvent(ctx.id, 'claude_event', evt); eventCount += 1; } catch {}
            ws.sendToClient(clientId, 'cc.event', { sessionId, event: evt });
        },
        onDone: () => {
            db.touchConversation(ctx.id, eventCount);
            runs.delete(sessionId);
            ws.sendToClient(clientId, 'cc.done', { sessionId });
            sendSessions('web');
        },
        onError: (err) => {
            db.touchConversation(ctx.id, eventCount);
            runs.delete(sessionId);
            ws.sendToClient(clientId, 'cc.error', { sessionId, error: err?.message || String(err) });
        },
    });

    runs.set(sessionId, child);
}

function abortRun(sessionId) {
    const child = runs.get(sessionId);
    if (child) {
        try { child.kill('SIGTERM'); } catch {}
        runs.delete(sessionId);
    }
}

module.exports = { handle, sendStatus, sendSessions };

const { randomUUID } = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const VALID_MODES = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan']);

function expandHome(p) {
    if (!p) return p;
    if (p === '~') return os.homedir();
    if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
    return p;
}

function toShape(row) {
    return {
        sessionId: row.sessionId,
        cwd: row.cwd,
        permissionMode: row.permissionMode || 'default',
        title: row.title,
        messageCount: row.messageCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        started: row.messageCount > 0,
    };
}

function createSession({ cwd, permissionMode } = {}) {
    const sessionId = randomUUID();
    const mode = VALID_MODES.has(permissionMode) ? permissionMode : 'default';
    const trimmed = typeof cwd === 'string' ? expandHome(cwd.trim()) : '';
    let targetCwd;
    if (trimmed) {
        if (!path.isAbsolute(trimmed)) return { error: 'cwd must be an absolute path' };
        targetCwd = path.resolve(trimmed);
        try {
            if (!fs.existsSync(targetCwd)) fs.mkdirSync(targetCwd, { recursive: true });
            else if (!fs.statSync(targetCwd).isDirectory()) return { error: 'cwd is not a directory' };
        } catch (err) {
            return { error: err?.message || 'cannot access directory' };
        }
    } else {
        targetCwd = path.join(os.homedir(), 'Desktop');
    }
    db.insertConversation({ sessionId, cwd: targetCwd, permissionMode: mode, title: '' });
    return toShape(db.getConversation(sessionId));
}

function deleteSession(sessionId) {
    db.deleteConversation(sessionId);
    return { ok: true };
}

function getSession(sessionId) {
    const row = db.getConversation(sessionId);
    return row ? toShape(row) : null;
}

function listSessions() {
    return db.listConversations().map(toShape);
}

function getContext(sessionId) {
    const row = db.getConversation(sessionId);
    if (!row) return null;
    return {
        id: row.id,
        sessionId: row.sessionId,
        cwd: row.cwd,
        permissionMode: row.permissionMode || 'default',
        started: row.messageCount > 0,
    };
}

function getMessages(sessionId) {
    const row = db.getConversation(sessionId);
    if (!row) return { items: [] };
    const events = db.listEvents(row.id);

    const items = [];
    let assistantEvents = [];
    let assistantId = 0;
    const flush = () => {
        if (!assistantEvents.length) return;
        items.push({
            id: `a-${row.id}-${assistantId}`,
            role: 'assistant',
            content: '',
            meta: { events: assistantEvents },
        });
        assistantId += 1;
        assistantEvents = [];
    };

    for (const ev of events) {
        const p = ev.payload;
        if (!p) continue;
        if (ev.kind === 'user_turn') {
            flush();
            items.push({
                id: `u-${row.id}-${ev.seq}`,
                role: 'user',
                content: p.message?.content || '',
            });
            continue;
        }
        if (p.type === 'user' && p.message?.content) {
            const c = p.message.content;
            const onlyToolResults = Array.isArray(c) && c.every((b) => b?.type === 'tool_result');
            if (onlyToolResults) {
                assistantEvents.push(p);
                continue;
            }
            flush();
            let text = '';
            if (typeof c === 'string') text = c;
            else if (Array.isArray(c)) text = c.find((b) => b.type === 'text')?.text || '';
            items.push({ id: `u-${row.id}-${ev.seq}`, role: 'user', content: text });
        } else if (p.type === 'assistant') {
            assistantEvents.push(p);
        } else if (p.type === 'system' || p.type === 'result') {
            assistantEvents.push(p);
        }
    }
    flush();
    return { items };
}

module.exports = { createSession, deleteSession, getSession, listSessions, getContext, getMessages };

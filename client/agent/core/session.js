const crypto = require('crypto');
const { getStore } = require('../../db');

const ACTIVE_KEY = 'agent.activeSessionId';

function newId() {
    return crypto.randomUUID();
}

function ensureActive() {
    const store = getStore();
    let id = store.getSetting(ACTIVE_KEY) || '';
    if (id && store.getSession(id)) return id;
    id = newId();
    store.ensureSession(id, '新会话');
    store.setSetting(ACTIVE_KEY, id);
    return id;
}

function getId() {
    return ensureActive();
}

function setActive(id) {
    const store = getStore();
    if (!store.getSession(id)) throw new Error(`会话不存在: ${id}`);
    store.setSetting(ACTIVE_KEY, id);
    return id;
}

function createNew(title = '新会话') {
    const store = getStore();
    const id = newId();
    store.ensureSession(id, title);
    store.setSetting(ACTIVE_KEY, id);
    return id;
}

function deleteSession(id) {
    const store = getStore();
    store.deleteSession(id);
    // 若删的是当前活跃，切到其它；没其它就新建
    const active = store.getSetting(ACTIVE_KEY);
    if (active === id) {
        const remaining = store.listSessions();
        if (remaining.length) {
            store.setSetting(ACTIVE_KEY, remaining[0].id);
        } else {
            const fresh = newId();
            store.ensureSession(fresh, '新会话');
            store.setSetting(ACTIVE_KEY, fresh);
        }
    }
    return store.getSetting(ACTIVE_KEY);
}

function getMeta(id = getId()) {
    const store = getStore();
    const row = store.getSession(id);
    if (!row) return { id, title: '新会话' };
    return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

function listAll() {
    const store = getStore();
    return store.listSessions().map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    }));
}

// 消息操作：都作用在当前活跃会话
function loadAllRows() {
    return getStore().loadMessages(getId());
}

function loadRowsPage({ offset = 0, limit = 50 } = {}) {
    const id = getId();
    const rows = getStore().loadMessagesPage(id, { offset, limit });
    const total = getStore().countMessages(id);
    return { rows, total, hasMore: offset + rows.length < total };
}

function loadAllLlmMessages() {
    const rows = loadAllRows();
    const out = [];
    for (const r of rows) {
        try { out.push(JSON.parse(r.message)); } catch {}
    }
    return out;
}

function appendMessage(msg) {
    getStore().appendMessage(getId(), msg);
}

function clearMessages() {
    const store = getStore();
    store.clearMessages(getId());
    store.updateSessionTitle(getId(), '新会话');
}

function updateTitleFromUserMessage(text) {
    const cleaned = String(text || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) return;
    const title = cleaned.length > 24 ? cleaned.slice(0, 24) + '…' : cleaned;
    getStore().updateSessionTitle(getId(), title);
}

module.exports = {
    ensureActive,
    getId,
    setActive,
    createNew,
    deleteSession,
    getMeta,
    listAll,

    loadAllRows,
    loadRowsPage,
    loadAllLlmMessages,
    appendMessage,
    clearMessages,
    updateTitleFromUserMessage,
};

import crypto from 'crypto';
import { getStore } from '../db.js';

const ACTIVE_KEY = 'agent.activeSessionId';
const DEFAULT_TITLE = '新会话';

function newId() {
    return crypto.randomUUID();
}

function ensureActive() {
    const store = getStore();
    let id = store.getSetting(ACTIVE_KEY) || '';
    if (id && store.getSession(id)) return id;
    id = newId();
    store.ensureSession(id, DEFAULT_TITLE);
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

function createNew(title = DEFAULT_TITLE) {
    const store = getStore();
    const id = newId();
    store.ensureSession(id, title);
    store.setSetting(ACTIVE_KEY, id);
    return id;
}

function deleteSession(id) {
    const store = getStore();
    store.deleteSession(id);
    if (store.getSetting(ACTIVE_KEY) === id) {
        const remaining = store.listSessions();
        if (remaining.length) {
            store.setSetting(ACTIVE_KEY, remaining[0].id);
        } else {
            const fresh = newId();
            store.ensureSession(fresh, DEFAULT_TITLE);
            store.setSetting(ACTIVE_KEY, fresh);
        }
    }
    return store.getSetting(ACTIVE_KEY);
}

function getMeta(id = getId()) {
    const row = getStore().getSession(id);
    if (!row) return { id, title: DEFAULT_TITLE };
    return {
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function listAll() {
    return getStore().listSessions().map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}

function loadAllRows() {
    return getStore().loadMessages(getId());
}

function loadRowsPage({ offset = 0, limit = 50 } = {}) {
    const id = getId();
    const rows = getStore().loadMessagesPage(id, { offset, limit });
    const total = getStore().countMessages(id);
    return { rows, total, hasMore: offset + rows.length < total };
}

function loadAllMessages() {
    return loadAllRows().flatMap((row) => {
        try { return [JSON.parse(row.message)]; } catch { return []; }
    });
}

function appendMessage(message, meta = null) {
    getStore().appendMessage(getId(), message, meta);
}

function clearMessages() {
    const store = getStore();
    store.clearMessages(getId());
    store.updateSessionTitle(getId(), DEFAULT_TITLE);
}

function updateTitleFromUserMessage(text) {
    const cleaned = String(text || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) return;
    const title = cleaned.length > 24 ? `${cleaned.slice(0, 24)}…` : cleaned;
    getStore().updateSessionTitle(getId(), title);
}

export { ensureActive, getId, setActive, createNew, deleteSession, getMeta, listAll, loadAllRows, loadRowsPage, loadAllMessages, appendMessage, clearMessages, updateTitleFromUserMessage };
export default {
    ensureActive,
    getId,
    setActive,
    createNew,
    deleteSession,
    getMeta,
    listAll,
    loadAllRows,
    loadRowsPage,
    loadAllMessages,
    appendMessage,
    clearMessages,
    updateTitleFromUserMessage,
};
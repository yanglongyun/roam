const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(os.homedir(), '.meem');
const DB_PATH = path.join(DB_DIR, 'meem.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '新会话',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message     TEXT NOT NULL,
    meta        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id   ON messages(session_id, id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_desc ON sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS cc_conversations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL UNIQUE,
    cwd             TEXT NOT NULL DEFAULT '',
    permission_mode TEXT NOT NULL DEFAULT 'default',
    title           TEXT NOT NULL DEFAULT '',
    message_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cc_convs_updated ON cc_conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS cc_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES cc_conversations(id),
    seq             INTEGER NOT NULL,
    kind            TEXT NOT NULL,
    raw_json        TEXT NOT NULL,
    ts              TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cc_events_conv_seq ON cc_events(conversation_id, seq);
`;

let rawDb = null;

function createStore() {
    fs.mkdirSync(DB_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    rawDb = db;
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);

    const stmts = {
        getSetting:         db.prepare('SELECT value FROM settings WHERE key = ?'),
        upsertSetting:      db.prepare(`
            INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `),
        insertSession:      db.prepare(`
            INSERT INTO sessions (id, title) VALUES (?, ?)
            ON CONFLICT(id) DO NOTHING
        `),
        touchSession:       db.prepare(`UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`),
        updateSessionTitle: db.prepare(`
            UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?
        `),
        getSession:         db.prepare('SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?'),
        listSessions:       db.prepare(`
            SELECT id, title, created_at, updated_at FROM sessions
            ORDER BY updated_at DESC LIMIT 200
        `),
        deleteSession:      db.prepare('DELETE FROM sessions WHERE id = ?'),
        deleteMessages:     db.prepare('DELETE FROM messages WHERE session_id = ?'),
        insertMessage:      db.prepare('INSERT INTO messages (session_id, message, meta) VALUES (?, ?, ?)'),
        countMessages:      db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?'),
        selectMessagesPage: db.prepare(`
            SELECT id, message, meta, created_at FROM messages
            WHERE session_id = ? ORDER BY id DESC LIMIT ? OFFSET ?
        `),
        selectAllMessages:  db.prepare(`
            SELECT id, message, meta, created_at FROM messages
            WHERE session_id = ? ORDER BY id ASC
        `),
    };

    return {
        getSetting(key) {
            const row = stmts.getSetting.get(key);
            return row ? row.value : null;
        },
        setSetting(key, value) {
            stmts.upsertSetting.run(key, String(value ?? ''));
        },
        ensureSession(id, title = '新会话') {
            stmts.insertSession.run(id, title);
        },
        getSession(id) {
            return stmts.getSession.get(id) || null;
        },
        listSessions() {
            return stmts.listSessions.all();
        },
        deleteSession(id) {
            stmts.deleteSession.run(id);
        },
        updateSessionTitle(id, title) {
            const t = String(title || '新会话').slice(0, 200);
            stmts.updateSessionTitle.run(t, id);
        },
        touchSession(id) {
            stmts.touchSession.run(id);
        },
        clearMessages(sessionId) {
            stmts.deleteMessages.run(sessionId);
        },
        appendMessage(sessionId, message, meta = null) {
            const payload = typeof message === 'string' ? message : JSON.stringify(message);
            stmts.insertMessage.run(sessionId, payload, meta ? JSON.stringify(meta) : null);
            stmts.touchSession.run(sessionId);
        },
        // 全量（小会话用）
        loadMessages(sessionId) {
            return stmts.selectAllMessages.all(sessionId);
        },
        // 分页：按 id 倒序取第 offset~offset+limit 条（即从后往前数 limit 条），再反转为正序
        loadMessagesPage(sessionId, { offset = 0, limit = 50 } = {}) {
            const rows = stmts.selectMessagesPage.all(sessionId, limit, offset);
            return rows.reverse();
        },
        countMessages(sessionId) {
            return stmts.countMessages.get(sessionId).n;
        },
    };
}

let singleton = null;
function getStore() {
    if (!singleton) singleton = createStore();
    return singleton;
}

function getDb() {
    if (!rawDb) getStore();
    return rawDb;
}

module.exports = { createStore, getStore, getDb, DB_PATH };

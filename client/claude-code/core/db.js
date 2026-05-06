const { getDb } = require('../../db');

let stmts = null;

function ensure() {
    if (stmts) return;
    const db = getDb();
    stmts = {
        insertConv: db.prepare(
            'INSERT INTO cc_conversations (session_id, cwd, permission_mode, title) VALUES (?, ?, ?, ?)'
        ),
        getConv: db.prepare(
            `SELECT id, session_id AS sessionId, cwd, permission_mode AS permissionMode,
                    title, message_count AS messageCount,
                    created_at AS createdAt, updated_at AS updatedAt
             FROM cc_conversations WHERE session_id = ?`
        ),
        listConvs: db.prepare(
            `SELECT id, session_id AS sessionId, cwd, permission_mode AS permissionMode,
                    title, message_count AS messageCount,
                    created_at AS createdAt, updated_at AS updatedAt
             FROM cc_conversations ORDER BY updated_at DESC LIMIT 200`
        ),
        setTitleIfEmpty: db.prepare(
            "UPDATE cc_conversations SET title = ? WHERE id = ? AND (title IS NULL OR title = '')"
        ),
        touch: db.prepare(
            "UPDATE cc_conversations SET message_count = message_count + ?, updated_at = datetime('now') WHERE id = ?"
        ),
        updatePermission: db.prepare(
            "UPDATE cc_conversations SET permission_mode = ?, updated_at = datetime('now') WHERE id = ?"
        ),
        deleteConvById: db.prepare('DELETE FROM cc_conversations WHERE id = ?'),
        deleteConvBySid: db.prepare('SELECT id FROM cc_conversations WHERE session_id = ?'),
        deleteEvents: db.prepare('DELETE FROM cc_events WHERE conversation_id = ?'),
        deleteConv: db.prepare('DELETE FROM cc_conversations WHERE session_id = ?'),

        appendEvent: db.prepare(
            'INSERT INTO cc_events (conversation_id, seq, kind, raw_json) VALUES (?, ?, ?, ?)'
        ),
        maxSeq: db.prepare(
            'SELECT COALESCE(MAX(seq), -1) AS m FROM cc_events WHERE conversation_id = ?'
        ),
        listEvents: db.prepare(
            `SELECT id, seq, kind, raw_json AS rawJson, ts
             FROM cc_events WHERE conversation_id = ? ORDER BY seq ASC`
        ),
    };
}

function insertConversation({ sessionId, cwd, permissionMode, title }) {
    ensure();
    return stmts.insertConv.run(sessionId, cwd, permissionMode || 'default', title || '');
}

function getConversation(sessionId) {
    ensure();
    return stmts.getConv.get(sessionId) || null;
}

function listConversations() {
    ensure();
    return stmts.listConvs.all();
}

function setTitleIfEmpty(id, title) {
    ensure();
    stmts.setTitleIfEmpty.run(title, id);
}

function touchConversation(id, delta) {
    ensure();
    stmts.touch.run(delta, id);
}

function updatePermissionMode(id, mode) {
    ensure();
    stmts.updatePermission.run(mode, id);
}

function deleteConversation(sessionId) {
    ensure();
    const row = stmts.deleteConvBySid.get(sessionId);
    if (!row) return;
    stmts.deleteEvents.run(row.id);
    stmts.deleteConv.run(sessionId);
}

function appendEvent(conversationId, kind, obj) {
    ensure();
    const row = stmts.maxSeq.get(conversationId);
    const seq = (row?.m ?? -1) + 1;
    stmts.appendEvent.run(conversationId, seq, kind, JSON.stringify(obj));
    return seq;
}

function listEvents(conversationId) {
    ensure();
    return stmts.listEvents.all(conversationId).map((r) => {
        let payload = null;
        try { payload = JSON.parse(r.rawJson); } catch {}
        return { id: r.id, seq: r.seq, kind: r.kind, payload, ts: r.ts };
    });
}

module.exports = {
    insertConversation,
    getConversation,
    listConversations,
    setTitleIfEmpty,
    touchConversation,
    updatePermissionMode,
    deleteConversation,
    appendEvent,
    listEvents,
};

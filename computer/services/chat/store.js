// 多对话本地存储:chats / messages / compactions 三表,落于共享库 roam.db。
// roam 一贯「数据留在本机」,不进仓库、不过 Worker。库与建表归 system/core/db.js,
// 本模块只做 chat 领域的读写。messages 整条 message 存 JSON,顺序靠自增 id。
import { randomUUID } from 'node:crypto';
import { getDb } from '../../core/db.js';

// 兼容旧签名:有些调用点 await ensureDir()
async function ensureDir() { getDb(); }

function rowToMeta(r, messageCount) {
    return {
        id: r.id,
        title: r.title || '新对话',
        state: r.state || 'idle',
        createdAt: r.created_at || 0,
        updatedAt: r.updated_at || 0,
        ...(messageCount != null ? { messageCount } : {}),
    };
}

function messagesOf(d, chatId) {
    return d.prepare('SELECT message FROM messages WHERE chat_id = ? ORDER BY id').all(chatId)
        .map((r) => JSON.parse(r.message));
}

async function readChat(id) {
    const d = getDb();
    const r = d.prepare('SELECT * FROM chats WHERE id = ?').get(id);
    if (!r) return null;
    return { ...rowToMeta(r), messages: messagesOf(d, id) };
}

async function createChat(title) {
    const d = getDb();
    const now = Date.now();
    const chat = {
        id: randomUUID(),
        title: String(title || '').trim() || '新对话',
        state: 'idle',
        createdAt: now,
        updatedAt: now,
        messages: [],
    };
    d.prepare('INSERT INTO chats (id, title, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(chat.id, chat.title, 'idle', now, now);
    return chat;
}

// 列表只回元信息(不含完整消息体),按更新时间倒序
async function listChats() {
    const d = getDb();
    const rows = d.prepare(`
        SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
        FROM chats c ORDER BY c.updated_at DESC
    `).all();
    return rows.map((r) => rowToMeta(r, r.message_count || 0));
}

async function appendMessages(id, messages, extra = {}) {
    const d = getDb();
    const chat = d.prepare('SELECT * FROM chats WHERE id = ?').get(id);
    if (!chat) throw new Error('对话不存在');
    const now = Date.now();
    const meta = extra.meta ? JSON.stringify(extra.meta) : '{}';
    const usage = extra.usage ? JSON.stringify(extra.usage) : '{}';
    d.exec('BEGIN');
    let lastId = null;
    try {
        const ins = d.prepare('INSERT INTO messages (chat_id, message, meta, usage, created_at) VALUES (?, ?, ?, ?, ?)');
        for (const m of messages) {
            const info = ins.run(id, JSON.stringify(m), meta, usage, now);
            lastId = Number(info.lastInsertRowid);
        }
        const title = extra.title != null ? String(extra.title) : chat.title;
        d.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id);
        d.exec('COMMIT');
    } catch (e) {
        d.exec('ROLLBACK');
        throw e;
    }
    return lastId;
}

function listMessagesRaw(chatId, { limit = 10000, afterId = 0 } = {}) {
    const d = getDb();
    return d.prepare('SELECT id, message, meta, usage FROM messages WHERE chat_id = ? AND id > ? ORDER BY id LIMIT ?')
        .all(chatId, afterId, limit)
        .map((r) => ({ id: r.id, message: JSON.parse(r.message), meta: JSON.parse(r.meta || '{}'), usage: JSON.parse(r.usage || '{}') }));
}

function getLatestCompaction(chatId) {
    const d = getDb();
    return d.prepare('SELECT * FROM compactions WHERE chat_id = ? ORDER BY id DESC LIMIT 1').get(chatId) || null;
}

function createCompaction({ chatId, startMessageId, endMessageId, summary, tokens }) {
    const d = getDb();
    const now = Date.now();
    const info = d.prepare('INSERT INTO compactions (chat_id, start_message_id, end_message_id, summary, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(chatId, startMessageId, endMessageId, summary, tokens, now);
    return Number(info.lastInsertRowid);
}

async function setState(id, state) {
    const d = getDb();
    const info = d.prepare('UPDATE chats SET state = ? WHERE id = ?').run(state, id);
    if (!info.changes) return null;
    return readChat(id);
}

async function renameChat(id, title) {
    const d = getDb();
    const chat = d.prepare('SELECT * FROM chats WHERE id = ?').get(id);
    if (!chat) throw new Error('对话不存在');
    const next = String(title || '').trim() || chat.title;
    d.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), id);
    return readChat(id);
}

async function deleteChat(id) {
    const d = getDb();
    const info = d.prepare('DELETE FROM chats WHERE id = ?').run(id);
    return info.changes > 0;
}

// 分页读取:默认取最后 limit 条;before 给定(上一页的 firstIndex)则取它之前的 limit 条。
async function getPage(id, limit = 50, before = null) {
    const d = getDb();
    const chat = d.prepare('SELECT * FROM chats WHERE id = ?').get(id);
    if (!chat) return null;
    const total = d.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?').get(id).n;
    const end = (before == null || before < 0 || before > total) ? total : before;
    const lim = Math.max(1, Number(limit) || 50);
    const start = Math.max(0, end - lim);
    const messages = d.prepare('SELECT message FROM messages WHERE chat_id = ? ORDER BY id LIMIT ? OFFSET ?')
        .all(id, end - start, start).map((r) => JSON.parse(r.message));
    return {
        meta: { ...rowToMeta(chat), total },
        messages,
        firstIndex: start,
        hasMore: start > 0,
    };
}

export { ensureDir, createChat, readChat, getPage, listChats, appendMessages, setState, renameChat, deleteChat, listMessagesRaw, getLatestCompaction, createCompaction };

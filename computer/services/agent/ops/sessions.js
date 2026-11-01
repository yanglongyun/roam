// 会话：列表、新建、打开、改名置顶、置顶排序、删除。
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fail, pick, requireSession } from './util.js';

const PAGE = 50;

// 会话列表。第一页是全部置顶对话加最近更新的 50 个；之后按 before / before_id 往下翻，只翻未置顶的。
export function list(context, args) {
    const { before = null, before_id: beforeId = '' } = pick(args, ['before', 'before_id']);
    if (before !== null && !Number.isSafeInteger(before)) {
        fail(400, 'before 无效');
    }
    const columns = `sessions.*, (
    SELECT item FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1
  ) AS first`;
    const db = context.db;
    let pinned = [];
    let rows;
    if (before === null) {
        pinned = db.prepare(`SELECT ${columns} FROM sessions WHERE pin IS NOT NULL ORDER BY pin`).all();
        rows = db
            .prepare(`SELECT ${columns} FROM sessions WHERE pin IS NULL ORDER BY updated_at DESC, id DESC LIMIT ?`)
            .all(PAGE + 1);
    } else {
        rows = db
            .prepare(`
      SELECT ${columns} FROM sessions
      WHERE pin IS NULL AND (updated_at < ? OR (updated_at = ? AND id < ?))
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `)
            .all(before, before, String(beforeId), PAGE + 1);
    }

    const sessions = [...pinned, ...rows.slice(0, PAGE)].map(({ first, ...session }) => {
        const content = first ? JSON.parse(first).content : [];
        let preview = content.map((part) => part.text || '').join('');
        preview = preview.replace(/\s+/g, ' ').slice(0, 60);
        if (!preview && content.some((part) => part.type === 'input_image')) {
            preview = '[图片]';
        }
        return {
            ...session,
            preview,
            pinned: session.pin !== null,
            running: context.runs.has(session.id),
        };
    });
    return { sessions, has_more: rows.length > PAGE };
}

export function create(context, args) {
    pick(args, []);
    const id = randomUUID();
    const title = '';
    const now = Date.now();
    context.db
        .prepare('INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, title, now, now);
    return { id, title, created_at: now, updated_at: now, pin: null, preview: '', pinned: false, running: false };
}

// 打开对话：最近 60 条消息、压缩记录、是否正在运行，以及正在运行时已输出但还没形成完整 item 的文字。
export function open(context, args) {
    const { id } = pick(args, ['id']);
    const db = context.db;
    requireSession(db, id);
    const rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 61').all(id);
    const messages = rows
        .slice(0, 60)
        .reverse()
        .map((row) => ({ ...row, item: JSON.parse(row.item), usage: row.usage ? JSON.parse(row.usage) : null }));
    const compactions = db.prepare('SELECT * FROM compactions WHERE session_id = ? ORDER BY id').all(id);
    const run = context.runs.get(id);
    return {
        messages,
        has_more: rows.length > 60,
        compactions,
        running: Boolean(run),
        streaming: run ? { text: run.text, reasoning: run.reasoning } : null,
    };
}

// 修改标题，或置顶 / 取消置顶。新置顶的对话排在置顶组最前面。
export function patch(context, args) {
    const data = pick(args, ['id', 'title', 'pinned']);
    const id = data.id;
    if (data.title === undefined && data.pinned === undefined) {
        fail(400, '缺少要修改的字段');
    }
    if (data.title !== undefined && (typeof data.title !== 'string' || [...data.title.trim()].length > 120)) {
        fail(400, '标题最多 120 字符');
    }
    if (data.pinned !== undefined && typeof data.pinned !== 'boolean') {
        fail(400, 'pinned 必须是布尔值');
    }
    const db = context.db;
    requireSession(db, id);
    db.exec('BEGIN IMMEDIATE');
    try {
        if (data.title !== undefined) {
            db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(data.title.trim(), id);
        }
        if (data.pinned === true && db.prepare('SELECT pin FROM sessions WHERE id = ?').get(id).pin === null) {
            const first = db.prepare('SELECT MIN(pin) AS pin FROM sessions').get().pin;
            let pin = 0;
            if (first !== null) {
                pin = first - 1;
            }
            db.prepare('UPDATE sessions SET pin = ? WHERE id = ?').run(pin, id);
        }
        if (data.pinned === false) {
            db.prepare('UPDATE sessions SET pin = NULL WHERE id = ?').run(id);
        }
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    return { ...session, pinned: session.pin !== null, running: context.runs.has(id) };
}

// 保存置顶组的完整顺序：ids 必须恰好是当前全部置顶对话。
export function pins(context, args) {
    const { ids } = pick(args, ['ids']);
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        fail(400, 'ids 必须是字符串数组');
    }
    const db = context.db;
    db.exec('BEGIN IMMEDIATE');
    try {
        const current = db.prepare('SELECT id FROM sessions WHERE pin IS NOT NULL').all().map((row) => row.id);
        if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) {
            fail(409, '置顶对话已变化，请刷新后再排序');
        }
        const update = db.prepare('UPDATE sessions SET pin = ? WHERE id = ?');
        for (let index = 0; index < ids.length; index++) {
            update.run(index, ids[index]);
        }
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    return { ids };
}

export async function remove(context, args) {
    const { id } = pick(args, ['id']);
    const db = context.db;
    requireSession(db, id);
    if (context.runs.has(id)) {
        fail(409, '会话正在回复，请先停止');
    }
    // 用户上传和工具图片都属于当前会话；删除记录前先取出文件名。
    const images = db
        .prepare(`
    SELECT DISTINCT json_extract(part.value, '$.image_url') AS url
    FROM messages, json_each(CASE
      WHEN json_extract(messages.item, '$.type') = 'message' THEN json_extract(messages.item, '$.content')
      WHEN json_type(messages.item, '$.output') = 'array' THEN json_extract(messages.item, '$.output')
      ELSE '[]' END) AS part
    WHERE session_id = ? AND json_extract(part.value, '$.type') = 'input_image'
  `)
        .all(id);
    db.exec('BEGIN IMMEDIATE');
    try {
        db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
        db.prepare('DELETE FROM compactions WHERE session_id = ?').run(id);
        db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    for (const image of images) {
        await fs.rm(path.join(context.paths.images, path.basename(image.url)), { force: true });
    }
    return { deleted: id };
}

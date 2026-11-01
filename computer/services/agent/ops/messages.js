// 消息：翻更早的消息、发消息（开始一轮回复）、停止。
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../agent/index.js';
import { message } from '../ai/index.js';
import { requireModel, renderPrompt } from '../config.js';
import { fail, pick, requireSession } from './util.js';

export function list(context, args) {
    const { id, limit: limitArg = 60, before: beforeArg = 0 } = pick(args, ['id', 'limit', 'before']);
    requireSession(context.db, id);
    if (!Number.isSafeInteger(limitArg) || limitArg < 0) {
        fail(400, 'limit 无效');
    }
    if (!Number.isSafeInteger(beforeArg) || beforeArg < 0) {
        fail(400, 'before 无效');
    }
    const limit = Math.min(500, Math.max(1, limitArg));
    const before = beforeArg;
    const rows = context.db
        .prepare(`
    SELECT * FROM messages
    WHERE session_id = ? AND (? = 0 OR id < ?)
    ORDER BY id DESC LIMIT ?
  `)
        .all(id, before, before, limit + 1);
    const messages = rows
        .slice(0, limit)
        .reverse()
        .map((row) => ({ ...row, item: JSON.parse(row.item), usage: row.usage ? JSON.parse(row.usage) : null }));
    return { messages, has_more: rows.length > limit };
}

// 发一条消息，开始一轮回复。用户消息存库后立即返回，回复过程通过事件推送。
export async function send(context, args) {
    const { id, text, images = [] } = pick(args, ['id', 'text', 'images']);
    if (!Array.isArray(images) || images.length > 5) {
        fail(400, '每条消息最多发送 5 张图片');
    }
    if (typeof text !== 'string' || Buffer.byteLength(text) > 128 * 1024 || (!text.trim() && images.length === 0)) {
        fail(400, '请输入文字或选择图片，文字最多 128 KiB');
    }
    // 图片先经上传操作保存为文件，这里只认上传给出的地址。
    for (const image of images) {
        let name = null;
        if (typeof image === 'string') {
            name = /^\/api\/images\/([a-f0-9-]{36}\.(?:png|jpeg|gif|webp))$/.exec(image);
        }
        if (!name) {
            fail(400, '图片地址无效，请重新上传');
        }
        try {
            await fs.access(path.join(context.paths.images, name[1]));
        } catch {
            fail(400, '图片不存在，请重新上传');
        }
    }
    try {
        requireModel(context.config);
    } catch (error) {
        fail(400, error.message);
    }
    const db = context.db;
    requireSession(db, id);
    // 检查和登记之间没有 await，同一会话不会同时开始两轮。
    if (context.runs.has(id)) {
        fail(409, '会话正在回复');
    }
    const state = { controller: new AbortController(), done: null, text: '', reasoning: '' };
    context.runs.set(id, state);

    try {
        const user = message(text);
        if (!text.trim()) {
            user.content = [];
        }
        for (const image of images) {
            user.content.push({ type: 'input_image', image_url: image, detail: 'auto' });
        }
        const saved = save(db, id, user);
        context.publish(id, { type: 'message', item: user, ...saved });
        state.done = reply(context, id, state);
        return saved;
    } catch (error) {
        context.runs.delete(id);
        throw error;
    }
}

// 停止这个会话正在运行的回复，等它真正结束（done 已推送）再返回。
export async function stop(context, args) {
    const { id } = pick(args, ['id']);
    const current = context.runs.get(id);
    if (current) {
        current.controller.abort(new DOMException('已停止', 'AbortError'));
        await current.done;
    }
    return { stopped: Boolean(current) };
}

// 存一条完整 item，同时更新会话时间。返回数据库 ID 和时间。
function save(db, id, item) {
    const createdAt = Date.now();
    const row = db
        .prepare('INSERT INTO messages (session_id, item, created_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(item), createdAt);
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(createdAt, id);
    return { id: Number(row.lastInsertRowid), created_at: createdAt };
}

async function reply(context, id, state) {
    const db = context.db;
    const push = (event) => context.publish(id, event);
    // 对话标题：用户起的标题，没有就用第一句话。浏览器插件用它给这个对话的标签组命名。
    const session = db
        .prepare('SELECT title, (SELECT item FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1) AS first FROM sessions WHERE id = ?')
        .get(id);
    let title = session.title;
    if (!title && session.first) {
        title = JSON.parse(session.first)
            .content.map((part) => part.text || '')
            .join('')
            .replace(/\s+/g, ' ')
            .slice(0, 40);
    }
    const config = {
        ...context.config,
        images_dir: context.paths.images,
        run_images: new Set(),
        // 浏览器插件的连接和当前对话，交给 browser 工具使用。
        browser: context.browser,
        session_id: id,
        session_title: title,
    };
    const timer = setTimeout(
        () => state.controller.abort(new DOMException('回复超时', 'TimeoutError')),
        config.run_timeout * 1000,
    );
    try {
        // 最近一次模型响应的用量，决定开始前是否压缩；没有就是 null，不回退到更早的用量。
        const previous = db
            .prepare(`
      SELECT usage FROM messages
      WHERE session_id = ? AND (
        json_extract(item, '$.role') = 'assistant'
        OR json_extract(item, '$.type') IN ('function_call', 'reasoning')
      )
      ORDER BY id DESC LIMIT 1
    `)
            .get(id);
        const usage = previous?.usage ? JSON.parse(previous.usage) : null;
        // 上下文 = 最新摘要 + 摘要覆盖位置之后的全部消息（已包含本次用户输入）。
        const latest = db.prepare('SELECT * FROM compactions WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(id);
        const stored = db
            .prepare('SELECT id, item FROM messages WHERE session_id = ? AND id > ? ORDER BY id')
            .all(id, latest?.message_id || 0);
        const messages = stored.map((row) => JSON.parse(row.item));
        // 与 messages 位置一一对应，压缩时把数组下标换算成数据库 ID。
        const messageIds = stored.map((row) => row.id);
        if (latest) {
            messages.unshift(message(latest.summary));
            messageIds.unshift(latest.message_id);
        }
        // 已存但还没有结果的工具调用；本次模型响应最后存入的一条，usage 附在它上面。
        const openCalls = new Set();
        let lastId = 0;

        await run({
            instructions: renderPrompt(config.system, config.workdir),
            messages,
            model: config.model,
            config,
            usage,
            signal: state.controller.signal,
            onEvent: (event) => {
                switch (event.type) {
                    case 'message':
                    case 'reasoning':
                    case 'function_call':
                    case 'function_call_output': {
                        if (!event.item) {
                            state[event.type === 'message' ? 'text' : 'reasoning'] += event.delta;
                            push(event);
                            return;
                        }
                        const saved = save(db, id, event.item);
                        messageIds.push(saved.id);
                        lastId = saved.id;
                        if (event.type === 'message') {
                            state.text = '';
                        } else if (event.type === 'reasoning') {
                            state.reasoning = '';
                        } else if (event.type === 'function_call') {
                            openCalls.add(event.item.call_id);
                        } else {
                            openCalls.delete(event.item.call_id);
                            // 工具图片已被存下的结果引用，不再属于待清理文件。
                            if (Array.isArray(event.item.output)) {
                                for (const part of event.item.output) {
                                    config.run_images.delete(part.image_url);
                                }
                            }
                        }
                        push({ ...event, ...saved });
                        return;
                    }
                    case 'usage': {
                        if (lastId && event.usage) {
                            db.prepare('UPDATE messages SET usage = ? WHERE id = ?').run(JSON.stringify(event.usage), lastId);
                        }
                        push(event);
                        return;
                    }
                    case 'compact': {
                        if (event.status !== 'completed') {
                            push(event);
                            return;
                        }
                        const messageId = messageIds[event.end - 1];
                        if (event.start !== 0 || !messageId) {
                            throw new Error('压缩边界无效');
                        }
                        const compaction = db
                            .prepare('INSERT INTO compactions (session_id, message_id, summary, created_at) VALUES (?, ?, ?, ?) RETURNING *')
                            .get(id, messageId, event.item.content[0].text, Date.now());
                        messageIds.splice(event.start, event.end - event.start, messageId);
                        push({
                            type: 'compact',
                            status: 'completed',
                            id: compaction.id,
                            message_id: compaction.message_id,
                            summary: compaction.summary,
                            created_at: compaction.created_at,
                        });
                        return;
                    }
                    case 'done': {
                        // 停止或失败时，给还没有结果的工具调用补一条，保证下次请求模型时调用和结果成对。
                        try {
                            for (const callId of openCalls) {
                                const item = {
                                    type: 'function_call_output',
                                    call_id: callId,
                                    output: JSON.stringify({ success: false, text: '已停止' }),
                                };
                                push({ type: 'function_call_output', item, ...save(db, id, item) });
                            }
                        } catch (error) {
                            console.error('补写工具结果失败：', error.message);
                        }
                        context.runs.delete(id);
                        push(event);
                        return;
                    }
                    default:
                        push(event);
                }
            },
        });
    } catch (error) {
        // Agent 在 run 内部收尾；走到这里说明准备上下文就失败了，补发 error 和 done。
        context.runs.delete(id);
        push({ type: 'error', code: 'api_error', error: error.message });
        push({ type: 'done', status: 'incomplete', stopReason: 'api_error' });
    } finally {
        clearTimeout(timer);
        context.runs.delete(id);
        for (const imageURL of config.run_images) {
            await fs.rm(path.join(context.paths.images, path.basename(imageURL)), { force: true });
        }
    }
}

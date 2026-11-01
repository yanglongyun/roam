// AI 服务：处理 ai.* / model.* 消息。
// - 多对话：ai.list / ai.create / ai.get / ai.rename / ai.delete
// - 发送：ai.send（流式经 ws.broadcast('ai.event') 推回所有已认证网页端）/ ai.abort
// - 模型配置：model.get / model.set（落地到 ~/.roam/roam.db 的 settings 表）
import ws from '../../ws.js';
import { chat } from './loop.js';
import { buildSystemPrompt } from './prompt.js';
import { getRunConfig, readConfig, writeConfig, publicView } from './config.js';
import { maybeCompactBeforeRun } from './compactions.js';
import * as store from './store.js';

const controllers = new Map(); // chatId -> AbortController

function emit(kind, data) {
    ws.broadcast('ai.event', { kind, ...data });
}

function reply(type, reqId, data) {
    ws.broadcast(type, { reqId, ...data });
}

async function listChatsWithLiveState() {
    const conversations = await store.listChats();
    const stale = [];
    for (const item of conversations) {
        if (item.state === 'running' && !controllers.has(item.id)) {
            item.state = 'idle';
            stale.push(item.id);
        }
    }
    stale.forEach((id) => store.setState(id, 'idle').catch(() => {}));
    return conversations;
}

async function pageWithLiveState(chatId, limit, before) {
    const page = await store.getPage(chatId, limit, before);
    if (page?.meta?.state === 'running' && !controllers.has(chatId)) {
        page.meta.state = 'idle';
        store.setState(chatId, 'idle').catch(() => {});
    }
    return page;
}

// 真正跑一轮对话：fire-and-forget，事件经 ws 流式推回。
async function runSend(d) {
    const chatId = String(d.chatId || '').trim();
    const content = String(d.content ?? '').trim();
    if (!chatId) { emit('error', { content: '缺少 chatId' }); return; }

    const existing = await store.readChat(chatId);
    if (!existing) { emit('error', { chatId, content: '对话不存在' }); return; }
    if (!content) return;

    if (controllers.has(chatId)) {
        controllers.get(chatId).abort();
        controllers.delete(chatId);
    }

    let config;
    try {
        config = await getRunConfig();
    } catch (err) {
        emit('error', { chatId, code: err.code || '', content: err.message });
        return;
    }

    const userMessage = { role: 'user', content };
    const extra = {};
    if (existing.messages.length === 0 || existing.title === '新对话') {
        extra.title = content.slice(0, 30);
    }
    await store.appendMessages(chatId, [userMessage], extra);
    emit('input', { chatId, message: userMessage, title: extra.title || null });
    await store.setState(chatId, 'running');
    emit('start', { chatId });

    const controller = new AbortController();
    controllers.set(chatId, controller);

    // 发送前尝试压缩：依据最近一条带用量的助手消息判断是否超阈值
    const latestUsage = [...store.listMessagesRaw(chatId)].reverse()
        .find((r) => Number(r.usage?.total_tokens) > 0)?.usage || {};
    const emitFn = ({ type, ...ev }) => emit(type, { chatId, ...ev });
    try {
        await maybeCompactBeforeRun({ chatId, usage: latestUsage, settings: config, emit: emitFn, signal: controller.signal });
    } catch (e) {
        console.error('压缩失败(不影响对话):', e.message);
    }

    // 取历史：只取最近压缩点之后的消息（压缩摘要本身在压缩点之后，会一并带上）
    const latestCompaction = store.getLatestCompaction(chatId);
    const afterId = Number(latestCompaction?.end_message_id || 0);
    const history = store.listMessagesRaw(chatId, { afterId }).map((r) => r.message);
    const modelMessages = [{ role: 'system', content: buildSystemPrompt(config) }, ...history];

    let pendingAssistant = null;
    let lastUsage = null;

    try {
        await chat(modelMessages, {
            apiUrl: config.apiUrl,
            apiKey: config.apiKey,
            model: config.model,
            toolResultMaxChars: config.toolResultMaxChars,
            signal: controller.signal,
            onEvent: async (event) => {
                if (event.type === 'message') {
                    emit('message', { chatId, content: event.content || '' });
                } else if (event.type === 'tool_calls') {
                    pendingAssistant = event.message || null;
                    emit('tool_calls', { chatId, toolCalls: event.message?.tool_calls || [] });
                } else if (event.type === 'tool_results') {
                    const msgs = event.messages || [];
                    const toPersist = [pendingAssistant, ...msgs].filter(Boolean);
                    pendingAssistant = null;
                    if (toPersist.length) await store.appendMessages(chatId, toPersist, { meta: { source: 'ai' } });
                    emit('tool_results', {
                        chatId,
                        results: msgs.map((m) => ({ toolCallId: m.tool_call_id || '', content: m.content ?? '' })),
                    });
                } else if (event.type === 'usage') {
                    lastUsage = event.usage || {};
                    emit('usage', { chatId, usage: lastUsage });
                } else if (event.type === 'done') {
                    if (event.message) await store.appendMessages(chatId, [event.message], { usage: event.usage || lastUsage || {} });
                    emit('done', { chatId });
                }
            },
        });
    } catch (err) {
        if (err?.name === 'AbortError') emit('aborted', { chatId });
        else emit('error', { chatId, content: err.message || String(err) });
    } finally {
        controllers.delete(chatId);
        await store.setState(chatId, 'idle');
    }
}

async function handle(message) {
    const t = message.type;
    const d = message.data || {};

    try {
        switch (t) {
            case 'ai.list': {
                reply('ai.list.result', d.reqId, { conversations: await listChatsWithLiveState() });
                return true;
            }
            case 'ai.create': {
                reply('ai.create.result', d.reqId, { conversation: await store.createChat(d.title) });
                return true;
            }
            case 'ai.get': {
                const page = await pageWithLiveState(d.chatId, d.limit || 50, d.before ?? null);
                reply('ai.get.result', d.reqId, {
                    chatId: d.chatId,
                    conversation: page?.meta || null,
                    messages: page?.messages || [],
                    firstIndex: page?.firstIndex ?? 0,
                    hasMore: page?.hasMore || false,
                });
                return true;
            }
            case 'ai.rename': {
                reply('ai.rename.result', d.reqId, { conversation: await store.renameChat(d.chatId, d.title) });
                return true;
            }
            case 'ai.delete': {
                if (controllers.has(d.chatId)) { controllers.get(d.chatId).abort(); controllers.delete(d.chatId); }
                reply('ai.delete.result', d.reqId, { ok: await store.deleteChat(d.chatId), chatId: d.chatId });
                return true;
            }
            case 'ai.send': {
                // 不 await：让循环在后台跑，dispatch 立即返回，ai.abort 等消息能并发处理
                runSend(d).catch((err) => console.error('ai.send 异常:', err?.message || err));
                return true;
            }
            case 'ai.abort': {
                const c = controllers.get(d.chatId);
                if (c) { c.abort(); controllers.delete(d.chatId); }
                await store.setState(d.chatId, 'idle');
                emit('aborted', { chatId: d.chatId });
                reply('ai.abort.result', d.reqId, { ok: true, chatId: d.chatId });
                return true;
            }
            case 'model.get': {
                reply('model.get.result', d.reqId, { config: publicView(await readConfig()) });
                return true;
            }
            case 'model.set': {
                reply('model.set.result', d.reqId, { ok: true, config: publicView(await writeConfig(d.config || {})) });
                return true;
            }
            default:
                return false;
        }
    } catch (err) {
        console.error(`ai 错误 [${t}]:`, err.message || err);
        reply('ai.error', d.reqId, { ok: false, error: err.message || String(err), chatId: d.chatId });
        return true;
    }
}

export { handle };
export default { handle };

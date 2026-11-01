// 上下文压缩：当 token 超阈值时，用 LLM 摘要旧消息，注入 compaction 消息继续对话。
import { callLlmStream } from './llm.js';
import * as store from './store.js';

const DEFAULT_COMPACT_PROMPT = `你负责压缩一段聊天上下文，供后续大模型继续对话时使用。

请保留：
- 用户明确提出的目标、偏好、限制和已经确认的决策
- 助手已经完成的关键改动、文件路径、接口协议和运行结果
- 工具调用中影响后续工作的事实
- 仍未解决的问题和下一步

请删除寒暄、重复内容、无效中间过程。输出中文摘要，结构清晰，避免编造。`;

const readTotalTokens = (usage = {}) => Number(usage.total_tokens || 0) || 0;

const serializeForSummary = (rows = []) => rows.map((row) => {
    const m = row.message || {};
    const role = m.role || 'unknown';
    let content = '';
    if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        content = [m.content || '', `tool_calls: ${JSON.stringify(m.tool_calls)}`].filter(Boolean).join('\n');
    } else if (role === 'tool') {
        content = `tool_call_id: ${m.tool_call_id || ''}\n${m.content || ''}`;
    } else {
        content = m.content || '';
    }
    return `#${row.id} ${role}\n${content}`;
}).join('\n\n---\n\n');

const keepSuffixStart = (rows = []) => {
    if (!rows.length) return 0;
    const last = rows[rows.length - 1]?.message || {};
    if (last.role === 'tool') {
        for (let i = rows.length - 1; i >= 0; i--) {
            const m = rows[i]?.message || {};
            if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) return i;
        }
    }
    return Math.max(0, rows.length - 1);
};

const DEFAULT_THRESHOLD = 12000;

const maybeCompactBeforeRun = async ({ chatId, usage, settings, emit, signal }) => {
    const threshold = Number(settings.compressThreshold ?? DEFAULT_THRESHOLD) || DEFAULT_THRESHOLD;
    const totalTokens = readTotalTokens(usage);
    if (!chatId || !totalTokens || totalTokens < threshold) return null;

    const latest = store.getLatestCompaction(chatId);
    const latestEnd = Number(latest?.end_message_id || 0);
    const rows = store.listMessagesRaw(chatId, { afterId: latestEnd })
        .filter((r) => r.meta?.kind !== 'compaction');
    const suffixStart = keepSuffixStart(rows);
    if (suffixStart <= 2) return null;

    const candidates = rows.slice(0, suffixStart);
    const startMessageId = candidates[0]?.id;
    const endMessageId = candidates[candidates.length - 1]?.id;
    if (!startMessageId || !endMessageId || endMessageId <= latestEnd) return null;

    const prompt = String(settings.compactPrompt || '').trim() || DEFAULT_COMPACT_PROMPT;
    const summaryInput = serializeForSummary(candidates);
    const payload = {
        model: settings.model,
        messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `请压缩以下聊天消息：\n\n${summaryInput}` },
        ],
    };
    emit?.({ type: 'compact_start', chatId, meta: { startMessageId, endMessageId, totalTokens, threshold } });

    try {
        const result = await callLlmStream(settings.apiUrl, settings.apiKey, payload, { signal });
        const summary = String(result.message?.content || '').trim();
        if (!summary) return null;

        const compTokens = readTotalTokens(result.usage);
        const id = store.createCompaction({ chatId, startMessageId, endMessageId, summary, tokens: compTokens });
        const compaction = { id, chat_id: chatId, start_message_id: startMessageId, end_message_id: endMessageId, summary, tokens: compTokens };
        const message = { role: 'user', content: `以下是历史上下文压缩摘要：\n\n${summary}` };
        const meta = { kind: 'compaction', startMessageId, endMessageId, tokens: compTokens, compaction };
        const messageId = await store.appendMessages(chatId, [message], { meta });
        emit?.({ type: 'input', chatId, id: messageId, kind: 'compaction', message, meta });
        return compaction;
    } finally {
        emit?.({ type: 'compact_done', chatId, meta: { startMessageId, endMessageId } });
    }
};

export { maybeCompactBeforeRun };

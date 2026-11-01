// 工具分发：按 tool_call.function.name 找 functions[name] 执行，结果拼成 tool 消息。
import * as functions from './functions.js';

const truncateToolResult = (content, maxChars = 12000) => {
    const text = String(content ?? '');
    if (text.length <= maxChars) return text;
    const head = Math.floor(maxChars * 0.7);
    const tail = maxChars - head;
    return `${text.slice(0, head)}\n...[truncated ${text.length - maxChars} chars]...\n${text.slice(-tail)}`;
};

const createAbortError = () => {
    if (typeof DOMException === 'function') return new DOMException('Aborted', 'AbortError');
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
};

const runTools = async (toolCalls, { signal, toolResultMaxChars = 12000 } = {}) => {
    const results = await Promise.all(toolCalls.map(async (tc) => {
        if (signal?.aborted) throw createAbortError();
        const name = tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        let content;
        try {
            const fn = functions[name];
            if (!fn) throw new Error(`未知工具: ${name}`);
            content = await fn(args, { signal });
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            content = `tool error: ${error.message}`;
        }
        const raw = typeof content === 'string' ? content : JSON.stringify(content);
        return {
            role: 'tool',
            tool_call_id: tc.id,
            content: truncateToolResult(raw, toolResultMaxChars),
        };
    }));
    return results;
};

export { runTools };

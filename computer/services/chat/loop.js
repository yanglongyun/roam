// 工具调用循环（取自 one/ai/index.js）。不对历史消息做加工：传入什么发什么；
// 模型返回的 assistant / tool 消息原样塞回 workMessages，继续下一轮。
import { tools } from './tools.js';
import { runTools } from './runner.js';
import { callLlmStream } from './llm.js';

const chat = async (messages, {
    apiUrl,
    apiKey,
    model,
    onEvent = () => {},
    signal,
    maxRounds = 50,
    toolResultMaxChars = 12000,
} = {}) => {
    const workMessages = Array.isArray(messages) ? [...messages] : [];
    let round = 0;

    while (round++ < maxRounds) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const payload = { model, messages: workMessages };
        if (Array.isArray(tools) && tools.length) payload.tools = tools;

        const result = await callLlmStream(apiUrl, apiKey, payload, {
            signal,
            onMessage: (content) => onEvent({ type: 'message', content }),
        });
        const message = result.message;

        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            workMessages.push(message);
            onEvent({ type: 'tool_calls', message });
            const toolMessages = await runTools(message.tool_calls, { signal, toolResultMaxChars });
            for (const tm of toolMessages) workMessages.push(tm);
            onEvent({ type: 'tool_results', messages: toolMessages });
            continue;
        }

        const text = message.content ?? '';
        workMessages.push(message);
        if (result.usage) onEvent({ type: 'usage', usage: result.usage });
        onEvent({ type: 'done', message, text, usage: result.usage || null });
        return { text, messages: workMessages };
    }

    const text = '(达到最大轮次限制)';
    const replyMsg = { role: 'assistant', content: text };
    workMessages.push(replyMsg);
    onEvent({ type: 'done', message: replyMsg, text });
    return { text, messages: workMessages };
};

export { chat };

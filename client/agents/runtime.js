import { callLlmStream } from '../llm/index.js';
import { loadAgent } from './registry.js';

function truncateToolResult(text, maxChars = 12000) {
    const raw = String(text ?? '');
    if (raw.length <= maxChars) return raw;
    const head = Math.floor(maxChars * 0.7);
    const tail = maxChars - head;
    return `${raw.slice(0, head)}\n...[truncated ${raw.length - maxChars} chars]...\n${raw.slice(-tail)}`;
}

async function executeTool(tool, args, ctx) {
    if (!tool) throw new Error('未找到工具映射');

    if (tool.type === 'agent') {
        const task = String(args.task || args.message || args.code || '').trim() || JSON.stringify(args);
        const result = await runAgent({
            agentName: tool.target,
            config: ctx.config,
            messages: [{ role: 'user', content: task }],
            signal: ctx.signal,
        });
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }

    if (tool.type === 'function' && typeof tool.execute === 'function') {
        const result = await tool.execute(args, ctx);
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }

    throw new Error(`不支持的工具类型: ${tool.type}`);
}

async function runAgent({
    agentName,
    config,
    messages,
    signal,
    onDelta,
    hooks,
}) {
    const agent = loadAgent(agentName);
    const convo = [];
    if (agent.prompt) convo.push({ role: 'system', content: agent.prompt });
    convo.push(...messages);

    for (let round = 0; round < 24; round += 1) {
        const message = await callLlmStream(config.apiUrl, config.apiKey, {
            model: config.model,
            messages: convo,
            tools: agent.tools,
        }, {
            provider: config.provider,
            signal,
            onDelta,
        });

        if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
            const assistantMsg = {
                role: 'assistant',
                content: message.content ?? null,
                tool_calls: message.tool_calls,
            };
            if (message.reasoning_content !== undefined) {
                assistantMsg.reasoning_content = message.reasoning_content;
            }

            convo.push(assistantMsg);
            hooks?.onAssistantToolCalls?.(assistantMsg);

            for (const toolCall of message.tool_calls) {
                hooks?.onToolCall?.(toolCall);
                let resultText;
                try {
                    const tool = agent.map.find((item) => item.name === toolCall.function.name);
                    const args = JSON.parse(toolCall.function.arguments || '{}');
                    resultText = truncateToolResult(await executeTool(tool, args, {
                        config,
                        signal,
                        agentName,
                    }));
                } catch (error) {
                    resultText = `tool error: ${error.message}`;
                }

                const toolMsg = {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: resultText,
                };
                convo.push(toolMsg);
                hooks?.onToolResult?.(toolCall, resultText, toolMsg);
            }
            continue;
        }

        const finalMessage = {
            role: 'assistant',
            content: String(message.content || ''),
        };
        if (message.reasoning_content !== undefined) {
            finalMessage.reasoning_content = message.reasoning_content;
        }
        hooks?.onFinalMessage?.(finalMessage, message.usage || null);
        return finalMessage.content;
    }

    const text = '(达到最大执行轮次限制)';
    hooks?.onFinalMessage?.({ role: 'assistant', content: text }, null);
    return text;
}

export { runAgent };
export default { runAgent };
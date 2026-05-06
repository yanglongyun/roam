const ws = require('../core/ws');
const config = require('./core/config');
const session = require('./core/session');
const { callLlmStream } = require('./core/llm');
const { tools } = require('./tools');
const { systemPrompt } = require('./prompt');
const runner = require('./runner');

const runs = new Map();

function abort(clientId) {
    const active = runs.get(clientId);
    if (active) {
        active.abortController.abort();
        runs.delete(clientId);
        return true;
    }
    return false;
}

function abortAll() {
    for (const [, active] of runs) {
        active.abortController.abort();
    }
    runs.clear();
}

async function chat(clientId, input) {
    const cfg = config.get();
    if (!cfg.apiUrl || !cfg.apiKey || !cfg.model) {
        throw new Error('Agent 未配置：请在"设置"里填入 API URL / API Key / Model');
    }

    abort(clientId);

    const history = session.loadAllLlmMessages();
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push(...history);

    const trimmed = String(input || '').trim();
    const isFirst = history.length === 0;
    const userMsg = { role: 'user', content: trimmed };
    messages.push(userMsg);
    session.appendMessage(userMsg);

    if (isFirst) {
        session.updateTitleFromUserMessage(trimmed);
        ws.broadcast('agent.session', session.getMeta());
        ws.broadcast('agent.sessions', { sessions: session.listAll(), activeId: session.getId() });
    }

    const abortController = new AbortController();
    runs.set(clientId, { abortController });
    ws.sendToClient(clientId, 'agent.run_state', { running: true });

    try {
        for (let round = 0; round < 24; round++) {
            const message = await callLlmStream(cfg.provider, cfg.apiUrl, cfg.apiKey, {
                model: cfg.model,
                messages,
                tools,
            }, {
                signal: abortController.signal,
                onDelta: (delta) => ws.sendToClient(clientId, 'agent.delta', { delta }),
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
                messages.push(assistantMsg);
                session.appendMessage(assistantMsg);

                for (const toolCall of message.tool_calls) {
                    ws.sendToClient(clientId, 'agent.tool_call', { toolCall });

                    const result = await runner.runOne(toolCall, { signal: abortController.signal });
                    messages.push(result.toolMsg);
                    session.appendMessage(result.toolMsg);
                    ws.sendToClient(clientId, 'agent.tool_result', {
                        toolCallId: toolCall.id,
                        content: result.resultText,
                    });
                }
                continue;
            }

            const text = String(message.content || '');
            const doneMsg = { role: 'assistant', content: text };
            messages.push(doneMsg);
            session.appendMessage(doneMsg);
            ws.sendToClient(clientId, 'agent.done', { content: text, usage: message.usage || null });
            return;
        }

        const text = '(达到最大轮次限制)';
        const capMsg = { role: 'assistant', content: text };
        messages.push(capMsg);
        session.appendMessage(capMsg);
        ws.sendToClient(clientId, 'agent.done', { content: text, usage: null });
    } finally {
        if (runs.get(clientId)?.abortController === abortController) {
            runs.delete(clientId);
        }
        ws.sendToClient(clientId, 'agent.run_state', { running: false });
    }
}

module.exports = { chat, abort, abortAll };

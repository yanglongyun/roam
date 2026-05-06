const functions = require('./functions');

function truncateToolResult(text, maxChars = 12000) {
    const raw = String(text ?? '');
    if (raw.length <= maxChars) return raw;
    const head = Math.floor(maxChars * 0.7);
    const tail = maxChars - head;
    return `${raw.slice(0, head)}\n...[truncated ${raw.length - maxChars} chars]...\n${raw.slice(-tail)}`;
}

async function runOne(toolCall, { signal } = {}) {
    const name = toolCall?.function?.name || 'unknown';
    const argsRaw = toolCall?.function?.arguments || '{}';

    let resultText;
    try {
        const fn = functions[name];
        if (!fn) throw new Error(`未知工具: ${name}`);
        const args = JSON.parse(argsRaw);
        const result = await fn(args, { signal });
        resultText = truncateToolResult(
            typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        );
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        resultText = `tool error: ${error.message}`;
    }

    return {
        toolCall,
        name,
        resultText,
        toolMsg: {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: resultText,
        },
    };
}

module.exports = { runOne };

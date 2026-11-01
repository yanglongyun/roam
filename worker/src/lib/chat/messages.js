let keySeq = 0;

function mkKey(prefix = 'm') {
    keySeq += 1;
    return `${prefix}:${Date.now().toString(36)}:${keySeq}`;
}

function safeParse(value) {
    if (value && typeof value === 'object') return value;
    try {
        return JSON.parse(value || '{}');
    } catch {
        return { _raw: String(value || '') };
    }
}

function toolName(toolCall) {
    return toolCall?.function?.name || toolCall?.name || 'tool';
}

function toolArgs(toolCall) {
    return safeParse(toolCall?.function?.arguments ?? toolCall?.arguments ?? {});
}

function mapToolCall(toolCall, status = 'running') {
    const id = toolCall?.id || toolCall?.toolCallId || mkKey('tool-call-id');
    return {
        type: 'tool_call',
        role: 'tool',
        _key: mkKey('tool'),
        toolCallId: id,
        toolCall,
        name: toolName(toolCall),
        args: toolArgs(toolCall),
        result: '',
        status,
        expanded: false,
    };
}

// 与电脑端 compactions.js 注入的摘要消息前缀一致
const COMPACTION_PREFIX = '以下是历史上下文压缩摘要：';

function isCompaction(message) {
    return message?.role === 'user' && String(message.content || '').startsWith(COMPACTION_PREFIX);
}

function renderMessages(raw) {
    const rows = [];
    const toolRowsById = new Map();

    for (const message of (raw || [])) {
        if (isCompaction(message)) {
            rows.push({ role: 'system', _key: mkKey('system'), content: '已自动压缩较早的上下文' });
            continue;
        }

        if (message.role === 'user') {
            rows.push({ role: 'user', _key: mkKey('user'), content: message.content || '' });
            continue;
        }

        if (message.role === 'assistant') {
            const text = String(message.content || '').trim();
            if (text) {
                rows.push({
                    role: 'assistant',
                    _key: mkKey('assistant'),
                    content: text,
                    usage: null,
                    streaming: false,
                });
            }
            for (const toolCall of (message.tool_calls || [])) {
                const row = mapToolCall(toolCall, 'done');
                toolRowsById.set(row.toolCallId, row);
                rows.push(row);
            }
            continue;
        }

        if (message.role === 'tool') {
            const row = toolRowsById.get(message.tool_call_id);
            if (row) {
                row.result = message.content || '';
                row.status = 'done';
            } else {
                rows.push({
                    type: 'tool_call',
                    role: 'tool',
                    _key: mkKey('tool'),
                    toolCallId: message.tool_call_id || '',
                    toolCall: null,
                    name: 'tool',
                    args: {},
                    result: message.content || '',
                    status: 'done',
                    expanded: false,
                });
            }
        }
    }

    return rows;
}

function isToolRow(row) {
    return row?.type === 'tool_call';
}

export { isToolRow, mapToolCall, mkKey, renderMessages, safeParse };

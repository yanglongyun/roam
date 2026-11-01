import { mapToolCall, mkKey } from './messages';

function findLastAssistant(messages) {
    for (let i = messages.value.length - 1; i >= 0; i -= 1) {
        const row = messages.value[i];
        if (row.role === 'assistant') return row;
    }
    return null;
}

function setupChatStream({
    messages,
    currentId,
    currentTitle,
    conversations,
    busy,
    pushRow,
    refresh,
    bumpStream,
}) {
    let streamingKey = '';

    function closeStreaming() {
        if (!streamingKey) return null;
        const row = messages.value.find((item) => item._key === streamingKey);
        if (row) row.streaming = false;
        streamingKey = '';
        return row;
    }

    function currentStreaming() {
        if (streamingKey) {
            const existing = messages.value.find((item) => item._key === streamingKey);
            if (existing) return existing;
        }
        const row = pushRow({
            role: 'assistant',
            _key: mkKey('assistant'),
            content: '',
            usage: null,
            streaming: true,
        });
        streamingKey = row._key;
        return row;
    }

    function updateTitle(title, chatId) {
        if (!title) return;
        currentTitle.value = title;
        const item = conversations.value.find((conversation) => conversation.id === chatId);
        if (item) item.title = title;
    }

    function completeToolResult(result) {
        const id = result?.toolCallId || result?.tool_call_id || '';
        let target = null;
        if (id) {
            target = messages.value.findLast?.((row) => row.type === 'tool_call' && row.toolCallId === id);
            if (!target) {
                for (let i = messages.value.length - 1; i >= 0; i -= 1) {
                    const row = messages.value[i];
                    if (row.type === 'tool_call' && row.toolCallId === id) {
                        target = row;
                        break;
                    }
                }
            }
        }
        if (!target) {
            for (let i = messages.value.length - 1; i >= 0; i -= 1) {
                const row = messages.value[i];
                if (row.type === 'tool_call' && row.status !== 'done') {
                    target = row;
                    break;
                }
            }
        }
        if (!target) return;
        target.result = result?.content || '';
        target.status = 'done';
    }

    function onEvent(event) {
        if (event.chatId && currentId.value && event.chatId !== currentId.value) {
            if (['done', 'aborted', 'error'].includes(event.kind)) refresh();
            return;
        }

        switch (event.kind) {
            case 'start':
                busy.value = true;
                closeStreaming();
                break;
            case 'input':
                updateTitle(event.title, event.chatId);
                if (event.message?.content) {
                    pushRow({ role: 'user', _key: mkKey('user'), content: event.message.content || '' });
                }
                break;
            case 'compact_start':
                pushRow({ role: 'system', _key: mkKey('system'), content: '上下文较长，正在压缩较早的消息…' });
                break;
            case 'compaction':
                pushRow({ role: 'system', _key: mkKey('system'), content: '已自动压缩较早的上下文' });
                break;
            case 'message': {
                const row = currentStreaming();
                row.content += event.content || '';
                break;
            }
            case 'tool_calls':
                closeStreaming();
                for (const toolCall of (event.toolCalls || [])) {
                    pushRow(mapToolCall(toolCall, 'running'));
                }
                break;
            case 'tool_results':
                for (const result of (event.results || [])) completeToolResult(result);
                break;
            case 'usage': {
                const row = closeStreaming() || findLastAssistant(messages);
                if (row) row.usage = event.usage || null;
                break;
            }
            case 'done':
                closeStreaming();
                busy.value = false;
                refresh();
                break;
            case 'aborted':
                closeStreaming();
                busy.value = false;
                break;
            case 'error':
                closeStreaming();
                pushRow({
                    role: 'system',
                    _key: mkKey('system'),
                    content: event.content || '出错了',
                    code: event.code || '',
                });
                busy.value = false;
                break;
            default:
                break;
        }

        bumpStream();
    }

    function resetStreaming() {
        closeStreaming();
    }

    return { onEvent, resetStreaming };
}

export { setupChatStream };

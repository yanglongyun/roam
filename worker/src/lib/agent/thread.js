// 历史和实时消息使用同一种记录（RawMessage：{ id, item, created_at, usage, key?, streaming?, sending?, failed? }）；
// 显示行（Row）从记录生成，不保存第二份可变状态。移植自 agentic 的 thread.ts。

export function itemText(item) {
    if (item.type === 'reasoning') {
        return [...(item.summary || []), ...(item.content || [])].map((part) => part.text).join('');
    }
    return (item.content || [])
        .map((part) => {
            if ('text' in part) return part.text;
            if (part.type === 'refusal') return part.refusal;
            return '';
        })
        .join('');
}

function images(parts) {
    return parts.filter((part) => part.type === 'input_image').map((part) => part.image_url);
}

function totalTokens(message) {
    const total = message.usage?.total_tokens;
    return typeof total === 'number' ? total : undefined;
}

// 分页先合并原始记录，再按 call_id 配对。跨页的调用与结果只显示一行。
export function mergeMessages(older, current) {
    const records = new Map();
    for (const message of [...older, ...current]) {
        records.set(message.id, message);
    }
    return [...records.values()].sort((a, b) => a.id - b.id);
}

export function buildRows(messages, compactions = [], busy = false) {
    const rows = [];
    const calls = new Map();
    // 压缩行按覆盖位置插入；早于当前页的摘要放在页首，加载旧页后自动归位。
    let compactIndex = 0;
    const summaries = [...compactions].sort((a, b) => a.message_id - b.message_id || a.id - b.id);
    const appendCompaction = (summary) => {
        rows.push({
            key: `compact:${summary.id}`,
            kind: 'system',
            code: 'compacted',
            content: summary.summary,
            at: summary.created_at,
            tokens: totalTokens(summary),
            cost: summary.cost || undefined,
        });
    };
    for (const message of messages) {
        while (compactIndex < summaries.length && message.id > 0 && summaries[compactIndex].message_id < message.id) {
            appendCompaction(summaries[compactIndex++]);
        }
        const item = message.item;
        const key = message.key || `message:${message.id}`;
        const at = message.created_at;
        switch (item.type) {
            case 'message':
                if (message.notification_id) {
                    const label = { done: '已完成', failed: '失败', needs_human: '需要你决定', cancelled: '已取消', interrupted: '被中断' }[message.task_status] || '有更新';
                    rows.push({ key, at, kind: 'system', code: 'task_notification', taskId: message.task_id,
                        content: message.task_title ? `任务${label}：${message.task_title}` : `任务${label}` });
                    break;
                }
                rows.push({
                    key,
                    at,
                    kind: item.role === 'user' ? 'user' : 'assistant',
                    content: itemText(item),
                    images: images(item.content),
                    streaming: message.streaming,
                    sending: message.sending,
                    failed: message.failed,
                    tokens: totalTokens(message),
                    cost: message.cost || undefined,
                });
                break;
            case 'reasoning':
                rows.push({ key, at, kind: 'assistant', reasoning: itemText(item), streaming: message.streaming });
                break;
            case 'function_call': {
                let args = {};
                try {
                    args = JSON.parse(item.arguments);
                } catch {
                    // 参数无效时仍展示调用；runner 返回明确的失败结果。
                }
                const row = {
                    key: `tool:${item.call_id}`,
                    at,
                    kind: 'tool',
                    callId: item.call_id,
                    name: item.name,
                    args,
                    result: '',
                    status: busy ? 'running' : 'done',
                };
                calls.set(item.call_id, row);
                rows.push(row);
                break;
            }
            case 'function_call_output': {
                let row = calls.get(item.call_id);
                if (!row) {
                    row = { key: `tool:${item.call_id}`, at, kind: 'tool', callId: item.call_id, name: 'tool', status: 'done' };
                    calls.set(item.call_id, row);
                    rows.push(row);
                }
                const text = typeof item.output === 'string'
                    ? item.output
                    : item.output.filter((part) => part.type === 'input_text').map((part) => part.text).join('\n');
                let result = { success: true, text };
                try {
                    result = JSON.parse(text);
                } catch {
                    // 非约定格式的结果按原文显示。
                }
                row.result = result.text;
                row.failed = !result.success;
                row.images = typeof item.output === 'string' ? [] : images(item.output);
                row.status = 'done';
                break;
            }
        }
        while (compactIndex < summaries.length && message.id > 0 && summaries[compactIndex].message_id === message.id) {
            appendCompaction(summaries[compactIndex++]);
        }
    }
    while (compactIndex < summaries.length) {
        appendCompaction(summaries[compactIndex++]);
    }
    return rows;
}

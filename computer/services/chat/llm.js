// 单文件 LLM 调用：构造请求头 + 流式 SSE 解析（取自 one，厂商无关）。
// 完整捕捉 choices[0].message 的所有字段（content / tool_calls / reasoning_content…），
// 原样拼回；流式过程中只把 content 增量经 onMessage 吐给上层。

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const ensureToolCall = (toolCalls, index) => {
    if (!toolCalls[index]) {
        toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
    }
    return toolCalls[index];
};

const mergeToolCallDelta = (target, delta) => {
    if (!isPlainObject(delta)) return target;
    for (const [key, value] of Object.entries(delta)) {
        if (value === undefined || key === 'index') continue;
        if (key === 'function' && isPlainObject(value)) {
            const fn = target.function || { name: '', arguments: '' };
            if (typeof value.name === 'string') fn.name = `${fn.name || ''}${value.name}`;
            if (typeof value.arguments === 'string') fn.arguments = `${fn.arguments || ''}${value.arguments}`;
            for (const [fnKey, fnValue] of Object.entries(value)) {
                if (fnKey === 'name' || fnKey === 'arguments' || fnValue === undefined) continue;
                fn[fnKey] = isPlainObject(fnValue)
                    ? { ...(isPlainObject(fn[fnKey]) ? fn[fnKey] : {}), ...fnValue }
                    : fnValue;
            }
            target.function = fn;
            continue;
        }
        target[key] = isPlainObject(value)
            ? { ...(isPlainObject(target[key]) ? target[key] : {}), ...value }
            : value;
    }
    return target;
};

const accumulate = (delta, state, onMessage) => {
    if (!isPlainObject(delta)) return;
    for (const [key, value] of Object.entries(delta)) {
        if (value == null) continue;
        if (key === 'role') {
            if (value) state.role = value;
        } else if (key === 'content') {
            if (typeof value === 'string' && value) {
                state.content += value;
                onMessage?.(value);
            }
        } else if (key === 'tool_calls' && Array.isArray(value)) {
            for (const tc of value) {
                mergeToolCallDelta(ensureToolCall(state.toolCalls, Number(tc?.index || 0)), tc);
            }
        } else if (typeof value === 'string') {
            state.extra[key] = `${state.extra[key] || ''}${value}`;
        } else if (isPlainObject(value)) {
            state.extra[key] = { ...(isPlainObject(state.extra[key]) ? state.extra[key] : {}), ...value };
        } else {
            state.extra[key] = value;
        }
    }
};

const assembleMessage = (state) => {
    const message = { role: state.role || 'assistant', ...state.extra };
    const toolCalls = state.toolCalls.filter(Boolean);
    if (toolCalls.length > 0) {
        message.content = state.content || null;
        message.tool_calls = toolCalls;
    } else {
        message.content = state.content;
    }
    return message;
};

const callLlmStream = async (apiUrl, apiKey, payload, { signal, onMessage } = {}) => {
    const streamPayload = {
        ...payload,
        stream: true,
        stream_options: { ...(payload.stream_options || {}), include_usage: true },
    };
    const state = { role: 'assistant', content: '', toolCalls: [], extra: {} };
    let usage = null;

    const headers = { 'Content-Type': 'application/json' };
    const url = String(apiUrl || '');
    if (url.includes('anthropic.com')) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
    } else if (url.includes('openrouter.ai')) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['HTTP-Referer'] = 'https://github.com/valueriver/roam';
        headers['X-Title'] = 'roam';
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const res = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(streamPayload),
        signal,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LLM ${res.status}: ${text}`);
    }
    if (!res.body) throw new Error('LLM stream body is empty');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep >= 0) {
            const event = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            sep = buffer.indexOf('\n\n');
            const dataLines = event
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trim());
            if (!dataLines.length) continue;
            const raw = dataLines.join('\n');
            if (!raw || raw === '[DONE]') continue;
            let json;
            try { json = JSON.parse(raw); } catch { continue; }
            if (json && json.usage) usage = json.usage;
            const delta = json?.choices?.[0]?.delta;
            if (delta) accumulate(delta, state, onMessage);
        }
    }

    return { message: assembleMessage(state), usage };
};

export { callLlmStream };

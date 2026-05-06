const { openaiParser } = require('./parsers/openai');
const { deepseekParser } = require('./parsers/deepseek');
const { kimiParser } = require('./parsers/kimi');
const { geminiParser } = require('./parsers/gemini');

function pickParser(provider, apiUrl) {
    const url = String(apiUrl || '');
    if (provider === 'deepseek' || url.includes('api.deepseek.com')) return deepseekParser;
    if (provider === 'kimi' || url.includes('moonshot.cn') || url.includes('kimi.com')) return kimiParser;
    if (provider === 'gemini' || url.includes('/gemini/')) return geminiParser;
    return openaiParser;
}

function buildHeaders(provider, apiUrl, apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (provider === 'claude') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
    } else {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    if (String(apiUrl || '').includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://meem.local';
        headers['X-Title'] = 'meem';
    }
    return headers;
}

function normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const promptTokens = Math.max(0, Number(usage.prompt_tokens) || 0);
    const completionTokens = Math.max(0, Number(usage.completion_tokens) || 0);
    const totalTokens = Math.max(0, Number(usage.total_tokens) || promptTokens + completionTokens);
    return { promptTokens, completionTokens, totalTokens };
}

async function callLlmStream(provider, apiUrl, apiKey, payload, { signal, onDelta } = {}) {
    const parser = pickParser(provider, apiUrl);
    const state = parser.createState();
    let usage = null;

    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: buildHeaders(provider, apiUrl, apiKey),
        body: JSON.stringify({ ...payload, stream: true }),
        signal,
    });
    if (!res.ok) {
        const text = await res.text();
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

            const raw = event
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trim())
                .join('\n');

            if (!raw || raw === '[DONE]') continue;
            let json;
            try { json = JSON.parse(raw); } catch { continue; }
            if (json?.usage) usage = normalizeUsage(json.usage);
            parser.parseChunk(json, state, onDelta);
        }
    }

    const message = parser.toMessage(state);
    message.usage = usage;
    return message;
}

module.exports = { callLlmStream };

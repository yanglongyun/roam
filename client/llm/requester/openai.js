function buildHeaders(apiKey, apiUrl) {
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
    };

    if (String(apiUrl || '').includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://meem.local';
        headers['X-Title'] = 'meem';
    }

    return headers;
}

function buildRegularRequest({ apiKey, apiUrl, payload, signal }) {
    return {
        method: 'POST',
        headers: buildHeaders(apiKey, apiUrl),
        body: JSON.stringify(payload),
        signal,
    };
}

function buildStreamRequest({ apiKey, apiUrl, payload, signal }) {
    return {
        method: 'POST',
        headers: buildHeaders(apiKey, apiUrl),
        body: JSON.stringify({
            ...payload,
            stream: true,
            stream_options: {
                include_usage: true,
            },
        }),
        signal,
    };
}

const openaiRequester = {
    buildRegularRequest,
    buildStreamRequest,
};

export { openaiRequester };
export default { openaiRequester };

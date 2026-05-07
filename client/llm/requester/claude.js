function buildHeaders(apiKey) {
    return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
    };
}

function buildRegularRequest({ apiKey, payload, signal }) {
    return {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: JSON.stringify(payload),
        signal,
    };
}

function buildStreamRequest({ apiKey, payload, signal }) {
    return {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: JSON.stringify({
            ...payload,
            stream: true,
        }),
        signal,
    };
}

const claudeRequester = {
    buildRegularRequest,
    buildStreamRequest,
};

export { claudeRequester };
export default { claudeRequester };

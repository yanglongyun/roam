function normalizeLlmPayload(payload, normalizer) {
    return {
        ...payload,
        messages: normalizer?.normalizeMessages(payload?.messages) || [],
    };
}

module.exports = { normalizeLlmPayload };

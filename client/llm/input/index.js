function normalizeLlmPayload(payload, normalizer) {
    return {
        ...payload,
        messages: normalizer?.normalizeMessages(payload?.messages) || [],
    };
}

export { normalizeLlmPayload };
export default { normalizeLlmPayload };
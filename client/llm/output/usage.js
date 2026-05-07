function normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const promptTokens = Math.max(0, Number(usage.prompt_tokens) || 0);
    const completionTokens = Math.max(0, Number(usage.completion_tokens) || 0);
    const totalTokens = Math.max(0, Number(usage.total_tokens) || promptTokens + completionTokens);
    return {
        promptTokens,
        completionTokens,
        totalTokens,
    };
}

export { normalizeUsage };
export default { normalizeUsage };
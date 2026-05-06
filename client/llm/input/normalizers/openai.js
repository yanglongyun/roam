function normalizeMessages(messages = []) {
    return Array.isArray(messages) ? messages : [];
}

module.exports = {
    openaiNormalizer: {
        normalizeMessages,
    },
};

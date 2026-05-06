const { openaiParser } = require('./openai');

const deepseekParser = {
    createState() {
        return { ...openaiParser.createState(), reasoningContent: '' };
    },

    parseChunk(json, state, onDelta) {
        openaiParser.parseChunk(json, state, onDelta);
        const choice = json?.choices?.[0];
        const delta = choice?.delta || {};
        const reasoningText =
            typeof delta.reasoning_content === 'string' ? delta.reasoning_content
            : typeof delta.reasoning === 'string' ? delta.reasoning
            : '';
        if (reasoningText) {
            state.reasoningContent += reasoningText;
        }
    },

    toMessage(state) {
        const message = openaiParser.toMessage(state);
        if (message.tool_calls || state.reasoningContent) {
            message.reasoning_content = state.reasoningContent || '';
        }
        return message;
    },
};

module.exports = { deepseekParser };

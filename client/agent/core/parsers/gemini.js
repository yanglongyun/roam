const { openaiParser } = require('./openai');

const geminiParser = {
    createState() {
        return openaiParser.createState();
    },
    parseChunk(json, state, onDelta) {
        openaiParser.parseChunk(json, state, onDelta);
    },
    toMessage(state) {
        return openaiParser.toMessage(state);
    },
};

module.exports = { geminiParser };

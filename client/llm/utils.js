function parseJson(text, label = 'llm.json') {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} parse failed: ${error.message}`);
    }
}

export { parseJson };
export default { parseJson };
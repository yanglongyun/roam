function generateTerminalId() {
    return 'term-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export { generateTerminalId };
export default { generateTerminalId };

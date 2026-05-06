function loadAgent(agentName) {
    switch (agentName) {
        case 'main':
            return {
                prompt: require('./main/prompt'),
                tools: require('./main/tools'),
                map: require('./main/map'),
            };
        case 'browser':
            return {
                prompt: require('./browser/prompt'),
                tools: require('./browser/tools'),
                map: require('./browser/map'),
            };
        case 'playwright':
            return {
                prompt: require('./playwright/prompt'),
                tools: require('./playwright/tools'),
                map: require('./playwright/map'),
            };
        default:
            throw new Error(`未知 agent: ${agentName}`);
    }
}

module.exports = { loadAgent };

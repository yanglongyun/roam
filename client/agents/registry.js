import mainPrompt from './main/prompt.js';
import mainTools from './main/tools.js';
import mainMap from './main/map.js';
import browserPrompt from './browser/prompt.js';
import browserTools from './browser/tools.js';
import browserMap from './browser/map.js';
import playwrightPrompt from './playwright/prompt.js';
import playwrightTools from './playwright/tools.js';
import playwrightMap from './playwright/map.js';

function loadAgent(agentName) {
    switch (agentName) {
        case 'main':
            return {
                prompt: mainPrompt,
                tools: mainTools,
                map: mainMap,
            };
        case 'browser':
            return {
                prompt: browserPrompt,
                tools: browserTools,
                map: browserMap,
            };
        case 'playwright':
            return {
                prompt: playwrightPrompt,
                tools: playwrightTools,
                map: playwrightMap,
            };
        default:
            throw new Error(`未知 agent: ${agentName}`);
    }
}

export { loadAgent };
export default { loadAgent };

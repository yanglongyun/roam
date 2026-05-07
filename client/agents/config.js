import { getStore } from '../db.js';

function get() {
    const store = getStore();
    return {
        provider: store.getSetting('agent.provider') || '',
        apiUrl: store.getSetting('agent.apiUrl') || '',
        apiKey: store.getSetting('agent.apiKey') || '',
        model: store.getSetting('agent.model') || '',
    };
}

function set(data = {}) {
    const current = get();
    const next = {
        provider: String(data.provider || '').trim() || current.provider,
        apiUrl: String(data.apiUrl || '').trim() || current.apiUrl,
        apiKey: String(data.apiKey || '').trim() || current.apiKey,
        model: String(data.model || '').trim() || current.model,
    };

    const store = getStore();
    store.setSetting('agent.provider', next.provider);
    store.setSetting('agent.apiUrl', next.apiUrl);
    store.setSetting('agent.apiKey', next.apiKey);
    store.setSetting('agent.model', next.model);
    return next;
}

export { get, set };
export default { get, set };
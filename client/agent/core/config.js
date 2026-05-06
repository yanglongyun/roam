const { getStore } = require('../../db');

function get() {
    const s = getStore();
    return {
        provider: s.getSetting('agent.provider') || '',
        apiUrl:   s.getSetting('agent.apiUrl')   || '',
        apiKey:   s.getSetting('agent.apiKey')    || '',
        model:    s.getSetting('agent.model')     || '',
    };
}

function set(data = {}) {
    const cur = get();
    const next = {
        provider: String(data.provider || '').trim() || cur.provider,
        apiUrl:   String(data.apiUrl   || '').trim() || cur.apiUrl,
        apiKey:   String(data.apiKey   || '').trim() || cur.apiKey,
        model:    String(data.model    || '').trim() || cur.model,
    };
    const s = getStore();
    s.setSetting('agent.provider', next.provider);
    s.setSetting('agent.apiUrl',   next.apiUrl);
    s.setSetting('agent.apiKey',   next.apiKey);
    s.setSetting('agent.model',    next.model);
    return next;
}

function configured() {
    const c = get();
    return Boolean(c.apiUrl && c.apiKey && c.model);
}

module.exports = { get, set, configured };

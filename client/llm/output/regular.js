const { normalizeUsage } = require('./usage');

async function parseRegularResponse(res) {
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM ${res.status}: ${text}`);
    }

    const json = await res.json();
    const message = json?.choices?.[0]?.message;
    if (!message) {
        throw new Error('LLM response missing message');
    }

    return {
        ...message,
        usage: normalizeUsage(json?.usage),
    };
}

module.exports = { parseRegularResponse };

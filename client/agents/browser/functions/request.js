const browserExtension = require('../../../server/browser-extension');

async function request(path, options = {}) {
    const response = await fetch(`${browserExtension.serviceUrl}${path}`, options);
    if (!response.ok) {
        throw new Error(`Browser bridge returned ${response.status}`);
    }
    return response.json();
}

async function createCommand(type, payload) {
    const response = await request('/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload }),
    });
    return response.command;
}

async function waitForCommand(id, timeoutSeconds = 15) {
    const deadline = Date.now() + Math.max(1, timeoutSeconds) * 1000;

    while (Date.now() < deadline) {
        const response = await request(`/commands/${id}`);
        const command = response.command;
        if (command.status === 'completed') return command.result;
        if (command.status === 'failed') {
            throw new Error(command.error || 'Browser command failed.');
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('Browser command timed out.');
}

async function runCommand(type, payload, timeoutSeconds) {
    const command = await createCommand(type, payload);
    return waitForCommand(command.id, timeoutSeconds);
}

module.exports = { request, runCommand };

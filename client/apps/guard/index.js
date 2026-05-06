const ws = require('../../server/ws');
const { SESSION_PASSWORD } = require('../../core/env');
const nonces = require('./core/nonces');
const challenge = require('./commands/challenge');
const submit = require('./commands/submit');

// onGrant 由 index.js 注入：发 auth.grant + 推各 feature 的初始快照
let onGrant = () => {};

function sendAuthMode() {
    ws.send({
        type: 'auth.mode',
        to: 'server',
        data: { requiresPassword: Boolean(SESSION_PASSWORD) },
    });
}

function bindOnGrant(fn) {
    onGrant = (clientId) => {
        nonces.clear(clientId);
        ws.send({ type: 'auth.grant', to: 'server', data: { clientId } });
        fn(clientId);
    };
}

function handle(message) {
    const clientId = message.meta?.clientId || message.data?.clientId || null;
    switch (message.type) {
        case 'auth.request_challenge':
            challenge.request(clientId, onGrant);
            return true;
        case 'auth.submit':
            submit.submit(clientId, message.data?.proof, onGrant);
            return true;
        default:
            return false;
    }
}

module.exports = { handle, sendAuthMode, bindOnGrant };

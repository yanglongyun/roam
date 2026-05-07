import ws from '../../server/ws.js';
import { SESSION_PASSWORD } from '../../core/env.js';
import nonces from './core/nonces.js';
import challenge from './commands/challenge.js';
import submit from './commands/submit.js';

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

export { handle, sendAuthMode, bindOnGrant };
export default { handle, sendAuthMode, bindOnGrant };
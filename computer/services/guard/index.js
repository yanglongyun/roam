import crypto from 'crypto';
import ws from '../../ws.js';
import { SESSION_PASSWORD } from '../../core/env.js';
import nonces from './core/nonces.js';
import challenge from './commands/challenge.js';
import submit from './commands/submit.js';

// onGrant 由 index.js 注入：发 auth.grant + 推各 feature 的初始快照
let onGrant = () => {};

// 密码的指纹：Worker 只拿它判断密码换没换，换了就作废之前发出的免密令牌。
const fingerprint = SESSION_PASSWORD
    ? crypto.createHmac('sha256', SESSION_PASSWORD).update('roam-auth-fingerprint').digest('hex')
    : '';

function sendAuthMode() {
    ws.send({
        type: 'auth.mode',
        to: 'server',
        data: { requiresPassword: Boolean(SESSION_PASSWORD), fingerprint },
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
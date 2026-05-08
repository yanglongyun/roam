import ws from '../../../ws.js';
import { SESSION_PASSWORD } from '../../../core/env.js';
import nonces from '../core/nonces.js';
import lockout from '../core/lockout.js';

function issueChallenge(clientId) {
    const nonce = nonces.issue(clientId);
    ws.send({
        type: 'auth.challenge',
        to: `web:${clientId}`,
        data: { nonce },
    });
    return nonce;
}

function closeWithLockout(clientId) {
    nonces.clear(clientId);
    const mins = lockout.remainingMinutes();
    ws.send({
        type: 'auth.close',
        to: 'server',
        data: {
            clientId,
            error: `认证已锁定，${mins} 分钟后重试`,
        },
    });
}

function request(clientId, onGrant) {
    if (!clientId) return;
    if (!SESSION_PASSWORD) {
        onGrant(clientId);
        return;
    }
    if (lockout.isLocked()) {
        closeWithLockout(clientId);
        return;
    }
    issueChallenge(clientId);
}

export { request, issueChallenge, closeWithLockout };
export default { request, issueChallenge, closeWithLockout };
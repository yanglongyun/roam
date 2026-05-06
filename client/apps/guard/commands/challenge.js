const ws = require('../../../server/ws');
const { SESSION_PASSWORD } = require('../../../core/env');
const nonces = require('../core/nonces');
const lockout = require('../core/lockout');

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

module.exports = { request, issueChallenge, closeWithLockout };

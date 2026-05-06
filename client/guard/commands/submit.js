const crypto = require('crypto');
const ws = require('../../core/ws');
const { SESSION_PASSWORD } = require('../../core/env');
const nonces = require('../core/nonces');
const lockout = require('../core/lockout');
const challenge = require('./challenge');

function submit(clientId, proof, onGrant) {
    if (!clientId) return;
    if (!SESSION_PASSWORD) {
        onGrant(clientId);
        return;
    }
    if (lockout.isLocked()) {
        challenge.closeWithLockout(clientId);
        return;
    }

    const nonceHex = nonces.take(clientId);
    if (!nonceHex) {
        // 挑战过期或不存在，重发一个让客户端重试
        challenge.issueChallenge(clientId);
        ws.send({
            type: 'auth.reject',
            to: 'server',
            data: { clientId, error: '挑战已过期，请重试' },
        });
        return;
    }

    const expected = crypto
        .createHmac('sha256', SESSION_PASSWORD)
        .update(Buffer.from(nonceHex, 'hex'))
        .digest();

    let proofBuf;
    try {
        proofBuf = Buffer.from(String(proof || ''), 'hex');
    } catch {
        proofBuf = Buffer.alloc(0);
    }
    const ok = proofBuf.length === expected.length
        && crypto.timingSafeEqual(proofBuf, expected);

    if (ok) {
        lockout.reset();
        onGrant(clientId);
        return;
    }

    const { locked, remaining } = lockout.recordFailure();
    if (locked) {
        challenge.closeWithLockout(clientId);
        return;
    }

    challenge.issueChallenge(clientId);
    ws.send({
        type: 'auth.reject',
        to: 'server',
        data: {
            clientId,
            error: `密码错误，剩余 ${remaining} 次`,
        },
    });
}

module.exports = { submit };

import crypto from 'crypto';

const NONCE_TTL_MS = 2 * 60_000;

const nonces = new Map();  // clientId -> { nonce, createdAt }

function issue(clientId) {
    const nonce = crypto.randomBytes(16).toString('hex');
    nonces.set(clientId, { nonce, createdAt: Date.now() });
    return nonce;
}

function take(clientId) {
    const entry = nonces.get(clientId);
    nonces.delete(clientId);
    if (!entry) return null;
    if (Date.now() - entry.createdAt >= NONCE_TTL_MS) return null;
    return entry.nonce;
}

function clear(clientId) {
    nonces.delete(clientId);
}

export { issue, take, clear };
export default { issue, take, clear };
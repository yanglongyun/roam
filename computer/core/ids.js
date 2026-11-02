import { randomBytes } from 'node:crypto';

// 会话 ID 在没设密码时就是访问云端对话的唯一凭据，用足够长的随机值。
function generateSessionId() {
    return randomBytes(9).toString('base64url');
}

function generateTerminalId() {
    return 'term-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export { generateSessionId, generateTerminalId };
export default { generateSessionId, generateTerminalId };

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// 设备 id：首次启动随机生成，存在 ~/.roam/device.json，之后一直复用。
// 不用主机名——macOS 的主机名会随网络环境变，id 必须稳定。
const FILE = path.join(os.homedir(), '.roam', 'device.json');

function generate() {
    return randomBytes(12).toString('base64url'); // 16 个字符
}

export function deviceId() {
    try {
        const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (typeof saved?.id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(saved.id)) return saved.id;
    } catch {}
    const id = generate();
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ id, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
    return id;
}

export default { deviceId };

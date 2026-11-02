import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, '..', 'config.js');
const envPath = path.join(__dirname, '..', '.env');

async function loadConfigFile() {
    if (!fs.existsSync(configPath)) return {};

    try {
        const loaded = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
        const value = loaded.default || loaded;
        return value && typeof value === 'object' ? value : {};
    } catch (error) {
        console.error(`配置文件加载失败: ${configPath}`);
        console.error(error.message || String(error));
        process.exit(1);
    }
}

function loadDotEnvFile() {
    if (!fs.existsSync(envPath)) return {};

    const text = fs.readFileSync(envPath, 'utf8');
    const values = {};
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        const eq = line.indexOf('=');
        if (eq < 0) continue;

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

// 环境变量 > .env > config.js
function resolveValue(key, sources) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
        return process.env[key];
    }

    for (const source of sources) {
        if (source && Object.prototype.hasOwnProperty.call(source, key)) {
            return source[key];
        }
    }
    return undefined;
}

function missing(key, hint = '') {
    console.error(`缺少 ${key} 配置${hint ? `（${hint}）` : ''}`);
    console.error('请在以下任一位置设置:');
    console.error(`  - ${configPath}`);
    console.error(`  - ${envPath}`);
    console.error(`  - 环境变量 ${key}`);
    process.exit(1);
}

const configValues = await loadConfigFile();
const dotEnvValues = loadDotEnvFile();
const sources = [dotEnvValues, configValues];

const CLOUDFLARE_WORKER_URL = String(resolveValue('CLOUDFLARE_WORKER_URL', sources) || '').trim();
if (!CLOUDFLARE_WORKER_URL) missing('CLOUDFLARE_WORKER_URL');

let parsed;
try {
    parsed = new URL(CLOUDFLARE_WORKER_URL);
} catch {
    console.error(`CLOUDFLARE_WORKER_URL 无效: ${CLOUDFLARE_WORKER_URL}`);
    process.exit(1);
}

const SERVER_URL = `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`;
const WEB_URL = parsed.origin;

// 和 Worker 的 DEVICE_TOKEN secret 一致，Worker 凭它认出这是自己的电脑端。
const DEVICE_TOKEN = String(resolveValue('DEVICE_TOKEN', sources) || '').trim();
if (!DEVICE_TOKEN) missing('DEVICE_TOKEN', '要和 Worker 的 DEVICE_TOKEN secret 一致');

// 这台设备在网页和助理眼里的名字与描述；云端一旦改过就以云端为准，这里只是初始值。
const DEVICE_NAME = String(resolveValue('DEVICE_NAME', sources) || '').trim();
const DEVICE_DESCRIPTION = String(resolveValue('DEVICE_DESCRIPTION', sources) || '').trim();

// 调试日志只认环境变量：DEBUG=1 node index.js
const DEBUG = String(process.env.DEBUG || '').trim() === '1';

export { CLOUDFLARE_WORKER_URL, SERVER_URL, WEB_URL, DEVICE_TOKEN, DEVICE_NAME, DEVICE_DESCRIPTION, DEBUG };
export default {
    CLOUDFLARE_WORKER_URL,
    SERVER_URL,
    WEB_URL,
    DEVICE_TOKEN,
    DEVICE_NAME,
    DEVICE_DESCRIPTION,
    DEBUG,
};

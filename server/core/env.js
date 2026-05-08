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

const configValues = await loadConfigFile();
const dotEnvValues = loadDotEnvFile();

const CLOUDFLARE_WORKER_URL = String(resolveValue('CLOUDFLARE_WORKER_URL', [dotEnvValues, configValues]) || '').trim();
if (!CLOUDFLARE_WORKER_URL) {
    console.error('缺少 CLOUDFLARE_WORKER_URL 配置');
    console.error('请在以下任一位置设置:');
    console.error(`  - ${configPath}`);
    console.error(`  - ${envPath}`);
    console.error('  - 环境变量 CLOUDFLARE_WORKER_URL');
    process.exit(1);
}

let parsed;
try {
    parsed = new URL(CLOUDFLARE_WORKER_URL);
} catch {
    console.error(`CLOUDFLARE_WORKER_URL 无效: ${CLOUDFLARE_WORKER_URL}`);
    process.exit(1);
}

const SERVER_URL = `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`;
const WEB_URL = parsed.origin;
const SESSION_ID = String(resolveValue('SESSION_ID', [dotEnvValues, configValues]) || '').trim();
if (SESSION_ID === 'default') {
    console.error('SESSION_ID 不能设置为 default');
    process.exit(1);
}
const SESSION_PASSWORD = String(resolveValue('SESSION_PASSWORD', [dotEnvValues, configValues]) || '').trim();
const DEBUG = String(resolveValue('DEBUG', [dotEnvValues, configValues]) || '0').trim() === '1';

export { CLOUDFLARE_WORKER_URL, SERVER_URL, WEB_URL, SESSION_ID, SESSION_PASSWORD, DEBUG };
export default {
    CLOUDFLARE_WORKER_URL,
    SERVER_URL,
    WEB_URL,
    SESSION_ID,
    SESSION_PASSWORD,
    DEBUG,
};

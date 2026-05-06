const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.js');
const envPath = path.join(__dirname, '..', '.env');

function loadConfigFile() {
    try {
        const loaded = require(configPath);
        return loaded && typeof loaded === 'object' ? loaded : {};
    } catch {
        return {};
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

const configValues = loadConfigFile();
const dotEnvValues = loadDotEnvFile();

const MEEM_URL = String(resolveValue('MEEM_URL', [dotEnvValues, configValues]) || '').trim();
if (!MEEM_URL) {
    console.error('Missing MEEM_URL');
    console.error('Set it in one of these places:');
    console.error(`  - ${configPath}`);
    console.error(`  - ${envPath}`);
    console.error('  - environment variable MEEM_URL');
    process.exit(1);
}

let parsed;
try {
    parsed = new URL(MEEM_URL);
} catch {
    console.error(`Invalid MEEM_URL: ${MEEM_URL}`);
    process.exit(1);
}

const SERVER_URL = `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`;
const WEB_URL = parsed.origin;
const SESSION_PASSWORD = String(resolveValue('SESSION_PASSWORD', [dotEnvValues, configValues]) || '').trim();
const BROWSER_CHANNEL = String(resolveValue('BROWSER_CHANNEL', [dotEnvValues, configValues]) || 'chrome').trim() || 'chrome';
const DEBUG = String(resolveValue('MEEM_DEBUG', [dotEnvValues, configValues]) || '0').trim() === '1';

module.exports = {
    MEEM_URL,
    SERVER_URL,
    WEB_URL,
    SESSION_PASSWORD,
    BROWSER_CHANNEL,
    DEBUG,
};

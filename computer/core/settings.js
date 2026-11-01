// 设置：KV 存于 roam.db 的 settings 表。模型配置（含 API Key）全落地本机，不进仓库、不过 Worker。
import { getDb } from './db.js';

const DEFAULTS = {
    baseUrl: '',
    apiKey: '',
    model: '',
    system: '',
    contextTurns: '100',
    compressThreshold: '12000',
    toolResultMaxChars: '12000',
    compactPrompt: '',
};

function getSetting(key, fallback = '') {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(String(key || ''));
    return row ? row.value : fallback;
}

function setSetting(key, value) {
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run(String(key || ''), String(value ?? ''));
}

function getSettings() {
    const rows = getDb().prepare('SELECT key, value FROM settings').all();
    return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

function setSettings(patch = {}) {
    const allowed = Object.keys(DEFAULTS);
    for (const [k, v] of Object.entries(patch)) {
        if (!allowed.includes(k) || v === undefined) continue;
        // 空 apiKey 视为「不改」，避免设置页回填掩码时把真 key 抹掉
        if (k === 'apiKey' && !String(v).trim()) continue;
        setSetting(k, v);
    }
    return getSettings();
}

export { DEFAULTS, getSetting, setSetting, getSettings, setSettings };

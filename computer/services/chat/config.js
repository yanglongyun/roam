// 模型配置：存于 roam.db 的 settings 表（KV）。API Key 只留在本机。
// 设置页（model.set）写入，agent（getRunConfig）读取。
// 首次运行若检测到旧版 ~/.roam/model.json，自动迁移进 settings 后删除。
import { promises as fsp } from 'fs';
import path from 'path';
import { ROOT } from '../../core/db.js';
import { getSettings, setSettings } from '../../core/settings.js';

const LEGACY_PATH = path.join(ROOT, 'model.json');
let migrated = false;

async function migrateLegacy() {
    if (migrated) return;
    migrated = true;
    try {
        const raw = await fsp.readFile(LEGACY_PATH, 'utf8');
        const v = JSON.parse(raw);
        if (v && typeof v === 'object') {
            setSettings({
                baseUrl: v.baseUrl ?? '',
                apiKey: v.apiKey ?? '',
                model: v.model ?? '',
                system: v.system ?? '',
                contextTurns: v.contextTurns != null ? String(v.contextTurns) : '100',
            });
            await fsp.rename(LEGACY_PATH, `${LEGACY_PATH}.bak`).catch(() => {});
            console.log('已将 model.json 迁移到 roam.db settings');
        }
    } catch { /* 没有旧文件，正常 */ }
}

async function readConfig() {
    await migrateLegacy();
    const s = getSettings();
    return {
        baseUrl: s.baseUrl || '',
        apiKey: s.apiKey || '',
        model: s.model || '',
        system: s.system || '',
        contextTurns: Number(s.contextTurns) || 100,
        compressThreshold: Number(s.compressThreshold) || 12000,
        toolResultMaxChars: Number(s.toolResultMaxChars) || 12000,
        compactPrompt: s.compactPrompt || '',
    };
}

async function writeConfig(patch = {}) {
    await migrateLegacy();
    setSettings(patch);
    return readConfig();
}

// baseUrl 末尾补成完整 completions 端点（已是完整端点则原样）
function resolveApiUrl(baseUrl) {
    const b = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    if (b.endsWith('/chat/completions') || b.endsWith('/completions')) return b;
    return `${b}/chat/completions`;
}

// agent 运行配置；缺字段抛带 code 的错，交给上层提示用户去设置
async function getRunConfig() {
    const c = await readConfig();
    const apiUrl = resolveApiUrl(c.baseUrl);
    const missing = [];
    if (!apiUrl) missing.push('API 地址');
    if (!c.apiKey) missing.push('API Key');
    if (!c.model) missing.push('模型');
    if (missing.length) {
        const err = new Error(`还没配置模型（缺：${missing.join('、')}）。请到「设置 → 模型设置」填好后再发消息。`);
        err.code = 'model_settings_missing';
        throw err;
    }
    return { apiUrl, apiKey: c.apiKey, model: c.model, system: c.system, contextTurns: c.contextTurns, compressThreshold: c.compressThreshold, toolResultMaxChars: c.toolResultMaxChars, compactPrompt: c.compactPrompt };
}

// 给 UI 的安全视图：不含明文 key，只给是否设置 + 预览
function publicView(c) {
    const k = String(c.apiKey || '');
    return {
        baseUrl: c.baseUrl || '',
        model: c.model || '',
        system: c.system || '',
        contextTurns: c.contextTurns ?? 100,
        compressThreshold: c.compressThreshold ?? 12000,
        toolResultMaxChars: c.toolResultMaxChars ?? 12000,
        compactPrompt: c.compactPrompt || '',
        hasKey: Boolean(k),
        keyPreview: !k ? '' : (k.length <= 8 ? '已设置' : `${k.slice(0, 4)}····${k.slice(-4)}`),
    };
}

export { readConfig, writeConfig, getRunConfig, publicView, resolveApiUrl };

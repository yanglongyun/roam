// 工具实现。函数名需与 tools.js 里的 function.name 对应。
// shell + 浏览器（browser_cdp，经 browser-use 扩展走 CDP）+ 电脑（cliclick/osascript）。
import { exec, execFile } from 'child_process';
import os from 'os';
import ws from '../../ws.js';
import cdpBridge from './cdp-bridge.js';
import * as computer from './computer.js';
import { getDefaultShell, getDefaultShellArgs } from '../terminal/core/shell.js';

const TIMEOUT_DEFAULT_MS = 30 * 1000;
const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 5 * 60 * 1000;
const MAX_BUFFER = 4 * 1024 * 1024;

const resolveTimeoutMs = (timeout) => {
    if (timeout == null) return TIMEOUT_DEFAULT_MS;
    const seconds = Number(timeout);
    if (!Number.isFinite(seconds)) return TIMEOUT_DEFAULT_MS;
    return Math.min(Math.max(seconds * 1000, TIMEOUT_MIN_MS), TIMEOUT_MAX_MS);
};

// roam 是用户自己的远程操控工具，shell 不限制目录（与终端能力一致），默认主目录。
// 与远程终端一样以登录 shell 执行，launchd 等方式启动时也能拿到用户平时的 PATH。
const shell = ({ command, cwd, timeout } = {}) => new Promise((resolve) => {
    const cmd = String(command || '');
    const args = process.platform === 'win32'
        ? ['-NoProfile', '-Command', cmd]
        : [...getDefaultShellArgs(), '-c', cmd];
    execFile(getDefaultShell(), args, {
        cwd: String(cwd || '').trim() || os.homedir(),
        env: process.env,
        timeout: resolveTimeoutMs(timeout),
        maxBuffer: MAX_BUFFER,
    }, (error, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('');
        if (error) { resolve(`exit code ${error.code ?? 1}\n${output || error.message}`); return; }
        resolve(output || '(no output)');
    });
});

// ───────── 浏览器：唯一工具，直发 CDP（经 browser-use 扩展） ─────────
// 默认作用于当前活动标签；绝大多数 DOM 操作用 Runtime.evaluate 跑 JS 即可。
const browser_cdp = async ({ method, params, tabId } = {}) => {
    if (!method) throw new Error('缺少 CDP method，例如 "Page.navigate"、"Runtime.evaluate"。');
    return cdpBridge.cdp(method, params || {}, tabId);
};

// ───────── 电脑（键鼠/截图） ─────────
const computer_status = async () => computer.status();
const computer_type = async ({ text } = {}) => computer.typeText({ text });
const computer_key = async ({ key, modifiers } = {}) => computer.pressKey({ key, modifiers });
const computer_click = async ({ x, y, button, clicks } = {}) => computer.click({ x, y, button, clicks });
const computer_move = async ({ x, y } = {}) => computer.mouseMove({ x, y });
const computer_scroll = async ({ direction, amount } = {}) => computer.scroll({ direction, amount });

// 截图：抓屏后把图片推给对话界面让“用户”看到，返回给模型的是元信息（不塞 base64，避免 token 爆炸）。
// 让模型“看”屏幕需视觉模型 + 把图作为图像消息回传，留待后续视觉增强。
const computer_screenshot = async () => {
    const shot = await computer.screenshot();
    try { ws.broadcast('ai.screenshot', { dataUrl: shot.dataUrl, screen: shot.screen, at: Date.now() }); } catch {}
    return {
        ok: true,
        screen: shot.screen,
        note: `已截图（${Math.round((shot.bytes || 0) / 1024)}KB，${shot.screen?.width || '?'}×${shot.screen?.height || '?'}），已推送到对话界面给用户查看。若需我据屏幕内容判断，请改用支持视觉的模型。`,
    };
};

const open_app = async ({ name } = {}) => new Promise((resolve) => {
    const n = String(name || '').trim();
    if (!n) { resolve('缺少应用名 name'); return; }
    if (process.platform !== 'darwin') { resolve('open_app 目前仅支持 macOS'); return; }
    exec(`open -a ${JSON.stringify(n)}`, { timeout: 15000 }, (error) => {
        resolve(error ? `打开失败: ${error.message}` : `已打开 ${n}`);
    });
});

export {
    shell,
    browser_cdp,
    computer_status, computer_type, computer_key, computer_click, computer_move, computer_scroll, computer_screenshot, open_app,
};

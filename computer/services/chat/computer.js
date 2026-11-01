// 电脑控制（本机，取自 one）。一切皆 shell：截图 screencapture+sips、鼠标 cliclick、键盘 osascript。
// 仅 macOS。鼠标/滚动需要 cliclick（brew install cliclick）；读屏/截图无第三方依赖。
import { execFile } from 'node:child_process';
import { captureCompressed } from '../../core/screenshot.js';

const run = (cmd, args, opts = {}) =>
    new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 20000, maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
            if (err) { err.stderr = stderr; reject(err); return; }
            resolve(String(stdout));
        });
    });

const has = async (cmd) => { try { await run('command', ['-v', cmd], { shell: '/bin/zsh' }); return true; } catch { return false; } };
const isMac = () => process.platform === 'darwin';
const ensureMac = () => { if (!isMac()) throw new Error('电脑控制当前仅支持 macOS'); };

// 逻辑屏幕尺寸（点，非视网膜像素）——cliclick 用逻辑坐标。
const screenSize = async () => {
    try {
        const out = await run('osascript', ['-e', 'tell application "Finder" to get bounds of window of desktop']);
        const nums = out.trim().split(',').map((n) => parseInt(n.trim(), 10));
        if (nums.length === 4) return { width: nums[2], height: nums[3] };
    } catch { /* ignore */ }
    return { width: 0, height: 0 };
};

const status = async () => {
    ensureMac();
    const [screencapture, osascript, cliclick] = await Promise.all([has('screencapture'), has('osascript'), has('cliclick')]);
    const size = await screenSize();
    let frontApp = '';
    try {
        frontApp = (await run('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'])).trim();
    } catch { /* ignore */ }
    return {
        platform: process.platform,
        drivers: { screencapture, osascript, cliclick },
        mouseReady: cliclick,
        keyboardReady: osascript,
        screen: size,
        frontApp,
    };
};

const screenshot = async () => {
    ensureMac();
    const shot = await captureCompressed();
    const size = await screenSize();
    return {
        dataUrl: `data:${shot.mime};base64,${shot.buffer.toString('base64')}`,
        bytes: shot.buffer.length,
        screen: size,
    };
};

const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`无效参数 ${name}`);
    return Math.round(n);
};

const requireCliclick = async () => {
    if (!(await has('cliclick'))) throw new Error('缺少 cliclick（鼠标/滚动需要）：brew install cliclick');
};

const mouseMove = async ({ x, y }) => {
    ensureMac(); await requireCliclick();
    await run('cliclick', [`m:${num(x, 'x')},${num(y, 'y')}`]);
    return { ok: true };
};

const click = async ({ x, y, button = 'left', clicks = 1 }) => {
    ensureMac(); await requireCliclick();
    const b = String(button).toLowerCase();
    const n = Math.max(1, num(clicks, 'clicks'));
    const prefix = b === 'right' ? 'rc' : n > 1 ? 'dc' : 'c';
    const hasXY = x !== undefined && y !== undefined;
    const target = hasXY ? `${prefix}:${num(x, 'x')},${num(y, 'y')}` : prefix;
    const times = prefix === 'c' ? n : 1;
    for (let i = 0; i < times; i += 1) await run('cliclick', [target]);
    return { ok: true, x, y, button: b, clicks: n };
};

const scroll = async ({ direction = 'down', amount = 3 }) => {
    ensureMac(); await requireCliclick();
    const code = { up: 'wu', down: 'wd', left: 'wl', right: 'wr' }[String(direction).toLowerCase()];
    if (!code) throw new Error(`无效滚动方向 ${direction}`);
    await run('cliclick', [`${code}:${Math.max(1, num(amount, 'amount'))}`]);
    return { ok: true, direction, amount };
};

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const typeText = async ({ text }) => {
    ensureMac();
    await run('osascript', ['-e', `tell application "System Events" to keystroke "${esc(text ?? '')}"`]);
    return { ok: true };
};

const KEY_CODES = {
    enter: 36, return: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53,
    home: 115, page_up: 116, end: 119, page_down: 121,
    left: 123, right: 124, down: 125, up: 126,
    f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};
const MODS = { command: 'command down', cmd: 'command down', meta: 'command down', control: 'control down', ctrl: 'control down', option: 'option down', alt: 'option down', shift: 'shift down' };

const pressKey = async ({ key, modifiers = [] }) => {
    ensureMac();
    const k = String(key || '').toLowerCase();
    const using = (Array.isArray(modifiers) ? modifiers : []).map((m) => MODS[String(m).toLowerCase()]).filter(Boolean);
    const usingClause = using.length ? ` using {${using.join(', ')}}` : '';
    if (KEY_CODES[k] !== undefined) {
        await run('osascript', ['-e', `tell application "System Events" to key code ${KEY_CODES[k]}${usingClause}`]);
    } else if (k.length === 1) {
        await run('osascript', ['-e', `tell application "System Events" to keystroke "${esc(k)}"${usingClause}`]);
    } else {
        throw new Error(`不支持的按键 ${key}`);
    }
    return { ok: true, key: k, modifiers };
};

const hotkey = async ({ keys = [] }) => {
    const list = (Array.isArray(keys) ? keys : []).filter(Boolean);
    if (list.length < 2) throw new Error('hotkey 至少需要两个键');
    return pressKey({ key: list.at(-1), modifiers: list.slice(0, -1) });
};

export { status, screenshot, mouseMove, click, scroll, typeText, pressKey, hotkey };

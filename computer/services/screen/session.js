import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const KEYS = new Set(['Enter', 'Tab', 'Space', 'Backspace', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown', 'a', 'c', 'v', 'x', 'z']);
const MODIFIERS = new Set(['meta', 'ctrl', 'alt', 'shift']);
const failure = (message, code = 'INVALID_INPUT') => Object.assign(new Error(message), { code });
export function validateInput(raw) {
    if (!raw || typeof raw !== 'object') throw failure('操作无效');
    if (raw.type === 'text') {
        if (typeof raw.text !== 'string' || !raw.text || raw.text.length > 10000) throw failure('输入文字应为 1 至 10000 字');
        return { type: 'text', text: raw.text };
    }
    if (raw.type === 'key') {
        if (!KEYS.has(raw.key) || !Array.isArray(raw.modifiers) || raw.modifiers.some((key) => !MODIFIERS.has(key))) throw failure('按键无效');
        return { type: 'key', key: raw.key, modifiers: [...new Set(raw.modifiers)] };
    }
    if (!['click', 'scroll'].includes(raw.type) || ![raw.x, raw.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw failure('操作位置无效');
    if (raw.type === 'click') {
        if (!['left', 'right'].includes(raw.button) || ![1, 2].includes(raw.count)) throw failure('点击方式无效');
        return { type: 'click', x: raw.x, y: raw.y, button: raw.button, count: raw.count };
    }
    if (![raw.deltaX, raw.deltaY].every((n) => Number.isFinite(n) && Math.abs(n) <= 1200)) throw failure('滚动距离无效');
    return { type: 'scroll', x: raw.x, y: raw.y, deltaX: raw.deltaX, deltaY: raw.deltaY };
}

// 截图与输入共享同一设备队列；设备端没有后台推屏定时器。
export function createScreenService({ capture, driver, send, now = Date.now, settle = (signal) => delay(250, undefined, { signal }) }) {
    const frames = new Map();
    const requests = new Map();
    let queue = Promise.resolve();
    function prune() {
        for (const [id, frame] of frames) if (now() - frame.at > 60000) frames.delete(id);
    }
    async function screenshot(owner, signal) {
        const display = await driver.display();
        const shot = await capture({ signal });
        signal.throwIfAborted();
        if (JSON.stringify(display) !== JSON.stringify(await driver.display())) throw failure('屏幕布局已变化，请重新截图', 'STALE_FRAME');
        const control = await driver.status();
        signal.throwIfAborted();
        const id = randomUUID();
        frames.set(id, { owner, display, width: shot.width, height: shot.height, at: now() });
        const own = [...frames].filter(([, frame]) => frame.owner === owner);
        for (const [oldId] of own.slice(0, -4)) frames.delete(oldId);
        return { ...shot, frameId: id, capturedAt: now(), control };
    }
    // 网页和任务共用一个执行入口，截图、输入以及操作后的截图不会被别的请求插入。
    async function perform(owner, args, { signal, captureAfter = false, pixels = false } = {}) {
        signal?.throwIfAborted();
        const key = `${owner}:${args.reqId || randomUUID()}`;
        if (requests.has(key)) return requests.get(key).work;
        if (requests.size >= 16) throw failure('设备忙，请稍后重试', 'SCREEN_BUSY');
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        const work = queue.then(async () => {
            controller.signal.throwIfAborted();
            prune();
            if (args.action === 'capture') return screenshot(owner, controller.signal);
            if (args.action === 'input') {
                const frame = frames.get(args.frameId);
                if (!frame || frame.owner !== owner) throw failure('画面已过期，请刷新后重试', 'STALE_FRAME');
                let raw = args.input;
                if (pixels && ['click', 'scroll'].includes(raw?.type)) {
                    if (![frame.width, frame.height].every((n) => Number.isSafeInteger(n) && n > 1) ||
                        ![raw.x, raw.y].every(Number.isFinite) || raw.x < 0 || raw.x >= frame.width || raw.y < 0 || raw.y >= frame.height) throw failure('操作位置超出截图范围');
                    raw = { ...raw, x: raw.x / (frame.width - 1), y: raw.y / (frame.height - 1) };
                }
                const input = validateInput(raw);
                const current = await driver.display();
                if (JSON.stringify(current) !== JSON.stringify(frame.display)) throw failure('屏幕布局已变化，请刷新后重试', 'STALE_FRAME');
                controller.signal.throwIfAborted();
                // 任何输入都可能改变桌面；其他网页或任务的旧画面不能继续点击。
                frames.clear();
                await driver.input(input, frame.display);
                if (!captureAfter) return {};
                try {
                    await settle(controller.signal);
                    return await screenshot(owner, controller.signal);
                } catch (error) {
                    controller.signal.throwIfAborted();
                    throw failure(`操作已执行，但未能获取新画面：${error.message}。请重新截图，不要重复上一次操作。`, 'ACTION_WITHOUT_FRAME');
                }
            }
            if (args.action === 'permission') return { control: await driver.permission() };
            throw failure('操作无效');
        }).then((result) => {
            controller.signal.throwIfAborted();
            return result;
        }).finally(() => {
            requests.delete(key);
            signal?.removeEventListener('abort', abort);
        });
        requests.set(key, { controller, work });
        queue = work.catch(() => {});
        return work;
    }
    async function handle(message) {
        if (!['screen.request', 'screen.cancel'].includes(message.type)) return false;
        const { reqId, ...args } = message.data || {};
        const client = message.meta?.clientId;
        if (!client || typeof reqId !== 'string' || !reqId || reqId.length > 100) return true;
        const owner = `web:${client}`;
        if (message.type === 'screen.cancel') { requests.get(`${owner}:${reqId}`)?.controller.abort(); return true; }
        try {
            const { buffer, ...result } = await perform(owner, { reqId, ...args });
            send(client, { reqId, ok: true, ...result, ...(buffer ? { data: buffer.toString('base64') } : {}) });
        } catch (error) {
            if (error.name !== 'AbortError') send(client, { reqId, ok: false, error: error.message || '屏幕操作失败', code: error.code || 'SCREEN_ERROR' });
        }
        return true;
    }
    function releaseClient(client) {
        const owner = `web:${client}`;
        for (const [key, request] of requests) if (key.startsWith(`${owner}:`)) request.controller.abort();
        for (const [id, frame] of frames) if (frame.owner === owner) frames.delete(id);
    }
    return { handle, releaseClient, perform };
}

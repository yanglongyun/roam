import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import runTool from '../services/agent/agent/runner.js';
import { createScreenService } from '../services/screen/session.js';

let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log(`✓ ${label}`); };
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-computer-test-'));
const events = [];
let captureFailure = false;
let settling = async () => {};
const screen = createScreenService({ send() {}, settle: (signal) => settling(signal),
    capture: async () => {
        events.push('capture');
        if (captureFailure) throw new Error('test capture failed');
        return { buffer: Buffer.from('test image'), mime: 'image/jpeg', width: 1001, height: 501 };
    },
    driver: { display: () => ({ id: 1, x: 0, y: 0, width: 1440, height: 932 }), status: () => ({ supported: true, allowed: true }),
        input: (input) => events.push(input) },
});
const config = { session_id: 'task-a', screen, images_dir: directory };
const call = (args, overrides = {}, signal) => runTool({ name: 'computer', arguments: JSON.stringify(args) }, { ...config, ...overrides }, signal);
const info = (result) => JSON.parse(result.text);
try {
    const first = await call({ action: 'screenshot' });
    check('桌面截图通过现有图片链返回，同时给出尺寸和画面编号', () => {
        assert.match(first.imageURL, /^\/api\/images\/.+\.jpeg$/);
        assert.equal(info(first).width, 1001);
        assert.ok(info(first).frame_id);
    });
    const clicked = await call({ action: 'click', frame_id: info(first).frame_id, x: 500, y: 250 });
    check('截图像素坐标换算为设备比例坐标，点击后返回新画面', () => {
        assert.deepEqual(events.at(-2), { type: 'click', x: .5, y: .5, button: 'left', count: 1 });
        assert.equal(events.at(-1), 'capture');
        assert.notEqual(info(first).frame_id, info(clicked).frame_id);
    });
    const repeated = await call({ action: 'click', frame_id: info(first).frame_id, x: 500, y: 250 });
    check('旧画面不能重复执行输入', () => assert.equal(repeated.failed, true));
    const foreign = await call({ action: 'type', frame_id: info(clicked).frame_id, text: '不能串任务' }, { session_id: 'task-b' });
    check('桌面画面按任务隔离', () => assert.equal(foreign.failed, true));
    const outside = await call({ action: 'click', frame_id: info(clicked).frame_id, x: 1001, y: 0 });
    check('超出截图范围的坐标不会被夹到边缘执行', () => assert.equal(outside.failed, true));
    const typed = await call({ action: 'type', frame_id: info(clicked).frame_id, text: '中文🙂' });
    check('中文和表情原样传给设备，并取得操作后的画面', () => assert.deepEqual(events.at(-2), { type: 'text', text: '中文🙂' }));
    const scrolled = await call({ action: 'scroll', frame_id: info(typed).frame_id, x: 250, y: 375, delta_y: 400 });
    check('滚动使用截图中的目标点和明确的滚动距离', () => assert.deepEqual(events.at(-2), { type: 'scroll', x: .25, y: .75, deltaX: 0, deltaY: 400 }));
    const keyed = await call({ action: 'key', frame_id: info(scrolled).frame_id, key: 'a', modifiers: ['meta'] });
    check('快捷键经过统一校验', () => assert.deepEqual(events.at(-2), { type: 'key', key: 'a', modifiers: ['meta'] }));
    const noTask = await call({ action: 'screenshot' }, { session_id: '' });
    check('没有任务归属时不访问桌面', () => assert.equal(noTask.failed, true));

    let entered;
    const began = new Promise((resolve) => { entered = resolve; });
    let release;
    settling = () => { entered(); return new Promise((resolve) => { release = resolve; }); };
    const atomic = call({ action: 'key', frame_id: info(keyed).frame_id, key: 'Enter' });
    await began;
    const web = screen.perform('web:test', { action: 'capture' });
    release();
    const [observed, webFrame] = await Promise.all([atomic, web]);
    check('输入与操作后截图共享队列，网页请求不能插入中间', () => {
        assert.equal(events.at(-3).type, 'key');
        assert.deepEqual(events.slice(-2), ['capture', 'capture']);
        assert.ok(webFrame.frameId);
    });

    const controller = new AbortController();
    settling = (signal) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        controller.abort();
    });
    const before = events.length;
    await assert.rejects(call({ action: 'key', frame_id: info(observed).frame_id, key: 'Tab' }, {}, controller.signal), { name: 'AbortError' });
    check('取消等待立即停止，不再截图或继续执行', () => assert.equal(events.length, before + 1));

    settling = async () => {};
    const current = await call({ action: 'screenshot' });
    captureFailure = true;
    const lost = await call({ action: 'key', frame_id: info(current).frame_id, key: 'Enter' });
    check('操作已执行但截图失败时明确告知，不鼓励重复操作', () => {
        assert.equal(lost.failed, true);
        assert.match(lost.text, /操作已执行.*不要重复/);
    });
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log(`\n${checks} 项桌面工具检查全部通过`);

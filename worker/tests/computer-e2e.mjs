// 真实 Worker / D1 / R2 / HTTP / WS，模型和桌面驱动使用隔离测试替身，不操作用户桌面。
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentHttpRequest } from '../shared/agent-http.js';
import { createScreenService } from '../../computer/services/screen/session.js';
import computer from '../../computer/services/agent/agent/functions/computer.js';

const port = Number(process.env.PORT || 9537), modelPort = port + 100;
const state = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-computer-e2e-'));
const cli = 'node_modules/wrangler/bin/wrangler.js';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label) {
    const end = Date.now() + 25000;
    while (Date.now() < end) { if (await fn()) return; await wait(25); }
    throw new Error(`超时：${label}`);
}
let checks = 0, dev, logs = '', holdCapture = false, captureAborted = false, captureHeld = false;
const check = (label, fn) => { fn(); checks++; console.log(`✓ ${label}`); };
const calls = [], actions = [], modelRequests = [], notices = [];
const pending = new Map(), sockets = [];
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYmsAAAAASUVORK5CYII=', 'base64');
const screen = createScreenService({ send() {}, settle: async () => {},
    capture: async ({ signal }) => {
        if (holdCapture) {
            captureHeld = true;
            await new Promise((resolve, reject) => signal.addEventListener('abort', () => { captureAborted = true; reject(signal.reason); }, { once: true }));
        }
        return { buffer: image, mime: 'image/png', width: 1001, height: 501 };
    },
    driver: { display: () => ({ id: 1, x: 0, y: 0, width: 1440, height: 932 }), status: () => ({ supported: true, allowed: true }), input: (input) => actions.push(input) },
});
const say = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const nextCall = (args) => ({ type: 'function_call', name: 'computer', call_id: crypto.randomUUID(), arguments: JSON.stringify(args) });
const script = [
    (frame) => ({ action: 'click', frame_id: frame, x: 500, y: 250 }),
    (frame) => ({ action: 'type', frame_id: frame, text: '中文🙂' }),
    (frame) => ({ action: 'scroll', frame_id: frame, x: 250, y: 375, delta_y: 400 }),
    (frame) => ({ action: 'key', frame_id: frame, key: 'Enter' }),
];
const model = http.createServer(async (req, res) => {
    try {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        let output;
        if (body.instructions.includes('现在是任务状态通知触发的回复')) {
            notices.push(body);
            assert.ok(!body.tools.some((tool) => tool.name === 'computer'));
            output = [say('已收到桌面任务结果')];
        } else {
            modelRequests.push(body);
            assert.ok(body.tools.some((tool) => tool.name === 'computer'));
            const results = body.input.filter((item) => item.type === 'function_call_output');
            if (!results.length) output = [nextCall({ action: 'screenshot' })];
            else {
                const last = results.at(-1);
                assert.equal(JSON.parse(last.output[0].text).success, true);
                assert.match(last.output[1].image_url, /^data:image\/png;base64,/);
                const frame = JSON.parse(JSON.parse(last.output[0].text).text).frame_id;
                output = script[results.length - 1] ? [nextCall(script[results.length - 1](frame))] : [say('桌面操作已完成，结果已验证')];
            }
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } })}\n\n`);
    } catch (error) { res.writeHead(400).end(JSON.stringify({ error: { message: error.message } })); }
});
function connect(kind) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?device=${kind}${kind === 'desktop' ? '&device_id=computer-test-device' : ''}`, kind === 'desktop' ? { headers: { authorization: 'Bearer e2e-token' } } : {});
    sockets.push(ws);
    const messages = [];
    ws.addEventListener('error', () => {});
    ws.addEventListener('message', async ({ data }) => {
        const msg = JSON.parse(data); messages.push(msg);
        if (kind !== 'desktop') return;
        if (msg.type === 'tool.cancel') { pending.get(msg.data.call_id)?.abort(); return; }
        if (msg.type !== 'tool.call') return;
        calls.push(msg.data);
        const controller = new AbortController();
        pending.set(msg.data.call_id, controller);
        try {
            const result = await computer(msg.data.arguments, { ...msg.data.config, images_dir: path.join(state, 'images'), screen }, controller.signal);
            const file = path.join(state, 'images', result.imageURL.split('/').at(-1));
            const bytes = await fs.readFile(file);
            await fs.rm(file);
            if (!controller.signal.aborted) send(ws, 'tool.result', { call_id: msg.data.call_id, result: { text: result.text, image: { base64: bytes.toString('base64'), mime: 'image/png' } } });
        } catch (error) {
            if (!controller.signal.aborted) send(ws, 'tool.result', { call_id: msg.data.call_id, result: { failed: true, text: error.message } });
        } finally { pending.delete(msg.data.call_id); }
    });
    return { ws, messages };
}
const send = (ws, type, data) => ws.send(JSON.stringify({ type, to: 'hub', data }));
let token;
async function request(op, args = {}) {
    const { url, method, body } = agentHttpRequest(op, args);
    const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, body, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) } });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(`${op}: ${result.error}`);
    return result.data;
}
try {
    execFileSync(process.execPath, [cli, 'd1', 'execute', 'roam', '--local', '--persist-to', state, '--file=server/agent/schema.sql', '--json'], { timeout: 30000, stdio: 'pipe', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
    await new Promise((resolve) => model.listen(modelPort, '127.0.0.1', resolve));
    dev = spawn(process.execPath, [cli, 'dev', '--port', String(port), '--persist-to', state, '--var', 'SETTINGS_KEY:dev', '--var', 'DEVICE_TOKEN:e2e-token', '--var', 'ACCESS_PASSWORD:e2e-pass'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
    dev.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-20000); });
    dev.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-20000); });
    await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}`)).ok; } catch { return false; } }, 'Worker ready');
    const web = connect('web'), device = connect('desktop');
    await until(() => web.ws.readyState === 1 && device.ws.readyState === 1, 'connected');
    send(web.ws, 'auth.submit', { password: 'e2e-pass' });
    send(device.ws, 'device.report', { name: '桌面测试设备', platform: 'darwin', workdir: '/tmp' });
    await until(() => web.messages.some((msg) => msg.data?.sessionToken), 'login');
    token = web.messages.find((msg) => msg.data?.sessionToken).data.sessionToken;
    await request('config.put', { responsesUrl: `http://127.0.0.1:${modelPort}/v1/responses`, apiKey: 'local-test', model: 'computer-test' });
    const task = await request('tasks.dispatch', { title: '桌面操作验收', goal: '验证桌面截图、点击、中文输入和滚动', device: 'computer-test-device' });
    await until(async () => (await request('tasks.get', { id: task.task_id })).task.status === 'done', 'task complete');
    await until(() => notices.length > 0, 'assistant notified');
    check('HTTP 创建任务后，经真实 Worker 中继调用设备桌面工具', () => {
        assert.equal(calls.length, 5);
        assert.ok(calls.every((call) => call.name === 'computer' && call.config.session_id === task.task_id));
    });
    check('模型循环接收操作后的图片和新画面编号，继续执行下一步', () => {
        assert.deepEqual(actions.map((action) => action.type), ['click', 'text', 'scroll', 'key']);
        assert.equal(actions[0].x, .5);
        assert.equal(actions[1].text, '中文🙂');
        assert.equal(actions[2].deltaY, 400);
        assert.equal(modelRequests.length, 6);
    });
    check('旧截图不反复传给模型，但完整截图记录仍可通过 HTTP 查询', () => {
        const pictures = modelRequests.at(-1).input.flatMap((item) => item.output || []).filter((part) => part.type === 'input_image');
        assert.equal(pictures.length, 2);
    });
    const history = await request('sessions.open', { id: task.task_id });
    check('任务保留全部五张截图，完成后自动上报助理', () => {
        assert.equal(history.messages.filter((row) => row.item.type === 'function_call_output' && row.item.output?.some((part) => part.type === 'input_image')).length, 5);
        assert.ok(notices.at(-1).input.some((item) => item.content?.some((part) => part.text?.includes(task.task_id))));
    });
    holdCapture = true;
    const stopping = await request('tasks.dispatch', { title: '取消桌面截图', goal: '取消桌面截图测试', device: 'computer-test-device' });
    await until(() => captureHeld, 'capture pending');
    await request('tasks.cancel', { id: stopping.task_id });
    await until(() => captureAborted && pending.size === 0, 'device cancellation');
    const stopped = await request('tasks.get', { id: stopping.task_id });
    check('停止任务通过 WS 取消设备端在途截图，任务状态为已取消', () => {
        assert.equal(stopped.task.status, 'cancelled');
        assert.equal(actions.length, 4);
    });
    console.log(`\n${checks} 项桌面任务端到端检查全部通过`);
} catch (error) { console.error(logs); throw error; }
finally {
    for (const controller of pending.values()) controller.abort();
    for (const ws of sockets) ws.close();
    if (dev && dev.exitCode === null) { const ended = new Promise((resolve) => dev.once('exit', resolve)); process.kill(-dev.pid, 'SIGTERM'); await ended; }
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
}

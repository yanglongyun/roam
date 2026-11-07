import assert from 'node:assert/strict';
import { listTools } from '../server/agent/tools.js';
import { createRunner } from '../server/agent/runner.js';
import { DeviceBridge } from '../server/agent/rpc.js';
import { prepareImages } from '../server/agent/ai.js';

let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log(`✓ ${label}`); };
check('助理没有桌面工具；任务只有明确启用时才提供', () => {
    assert.ok(!listTools({ mode: 'router', computer: true }).some((tool) => tool.name === 'computer'));
    assert.ok(!listTools({ mode: 'task' }).some((tool) => tool.name === 'computer'));
    assert.ok(listTools({ mode: 'task', computer: true }).some((tool) => tool.name === 'computer'));
    assert.ok(listTools({ mode: 'task', computer: true }).every((tool) => !tool.parameters.properties.device));
});
const sent = [];
const bridge = new DeviceBridge();
const controller = new AbortController();
const pending = bridge.call({ deviceId: 'mac', name: 'computer', args: { action: 'screenshot' }, signal: controller.signal, send: (id, msg) => { sent.push({ id, ...msg }); return true; } });
controller.abort();
await assert.rejects(pending, { name: 'AbortError' });
check('停止任务将取消请求发到原设备，并清理等待', () => {
    assert.equal(sent[1].type, 'tool.cancel');
    assert.equal(sent[1].id, 'mac');
    assert.equal(sent[1].data.call_id, sent[0].data.call_id);
    assert.equal(bridge.size, 0);
    assert.equal(bridge.settle({ call_id: sent[0].data.call_id, result: {} }), false);
});
const timeoutSent = [];
await assert.rejects(bridge.call({ deviceId: 'mac', name: 'computer', args: {}, timeoutMs: 5,
    send: (id, msg) => { timeoutSent.push(msg); return true; } }), { code: 'tool_timeout' });
check('工具超时也取消设备端工作', () => assert.equal(timeoutSent.at(-1).type, 'tool.cancel'));

let calls = 0;
const bound = { boundDeviceId: 'mac', devices: () => [{ id: 'mac', online: true, platform: 'darwin' }], bridge: { call: async () => { calls++; return { text: 'ok' }; } } };
const operation = { name: 'computer', arguments: JSON.stringify({ action: 'screenshot' }) };
const missingImages = await createRunner({ ...bound, env: {} })(operation, {});
const wrongPlatform = await createRunner({ ...bound, env: { IMAGES: {} }, devices: () => [{ id: 'mac', online: true, platform: 'linux' }] })(operation, {});
check('没有图片存储或不支持的设备在下发前就拒绝', () => {
    assert.equal(missingImages.failed, true);
    assert.equal(wrongPlatform.failed, true);
    assert.equal(calls, 0);
});

const url = (n) => `/api/images/00000000-0000-0000-0000-${String(n).padStart(12, '0')}.jpeg`;
const messages = [];
for (let n = 1; n <= 4; n++) {
    messages.push({ type: 'function_call', name: 'computer', call_id: `desktop-${n}` });
    messages.push({ type: 'function_call_output', call_id: `desktop-${n}`, output: [{ type: 'input_text', text: `frame-${n}` }, { type: 'input_image', image_url: url(n), detail: 'auto' }] });
}
messages.push({ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: url(9), detail: 'auto' }] });
const reads = [];
const input = await prepareImages({ IMAGES: { get: async (name) => { reads.push(name); return { arrayBuffer: async () => new Uint8Array([1, 2]).buffer }; } } }, messages);
check('只向模型传最近两张桌面截图，用户图片继续传递', () => {
    assert.equal(reads.length, 3);
    assert.ok(!reads.some((name) => name.endsWith('000000000001.jpeg')));
    assert.match(input[1].output[1].text, /较早的桌面截图/);
    assert.match(input[7].output[1].image_url, /^data:image\/jpeg;base64,/);
    assert.match(input.at(-1).content[0].image_url, /^data:image\/jpeg;base64,/);
});
check('省略模型输入中的旧图不会修改历史消息', () => assert.equal(messages[1].output[1].image_url, url(1)));
console.log(`\n${checks} 项云端桌面工具检查全部通过`);

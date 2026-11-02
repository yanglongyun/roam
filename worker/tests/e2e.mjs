// 真实运行时联调：wrangler dev（本地 D1 + R2 + DO）+ 假模型 HTTP + 假设备 WS。
// 前提：dev 已起在 9507，并且已用 schema.sql 初始化本地 D1：
//   npx wrangler d1 execute roam --local --file=server/agent/schema.sql
//   npx wrangler dev --port 9507 --var SETTINGS_KEY:dev --var DEVICE_TOKEN:e2e-token --var ACCESS_PASSWORD:e2e-pass
import http from 'node:http';

const PORT = Number(process.env.PORT || 9507);
// 和 wrangler dev 的 --var 一致
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || 'e2e-token';
const PASSWORD = process.env.ACCESS_PASSWORD || 'e2e-pass';
const URL_BASE = `ws://127.0.0.1:${PORT}/ws`;
const DEV_A = `e2e-a-${Date.now().toString(36)}`;
const DEV_B = `e2e-b-${Date.now().toString(36)}`;

const log = (...args) => console.log(...args);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, ok, detail = '') {
  log(`${ok ? '✓' : '✗'} ${label}${detail ? `：${detail}` : ''}`);
  if (!ok) failures += 1;
}

/* ── 假模型：按顺序吐回合 ── */
const rounds = [];
const model = http.createServer((req, res) => {
  const round = rounds.shift();
  if (!round) {
    res.writeHead(500).end('no more rounds');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of round.events || []) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'response.completed', response: round.response })}\n\n`);
  res.end();
});
await new Promise((r) => model.listen(9611, '127.0.0.1', r));
const call = (id, name, args) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
const say = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const round = (output, usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }) => ({ response: { status: 'completed', output, usage } });

/* ── WS 客户端 ── */
function client(kind, { authToken = '', deviceToken = DEVICE_TOKEN, deviceId = '' } = {}) {
  const params = new URLSearchParams({ device: kind });
  if (authToken) params.set('authToken', authToken);
  if (deviceId) params.set('device_id', deviceId);
  const headers = kind === 'desktop' && deviceToken ? { authorization: `Bearer ${deviceToken}` } : {};
  const ws = new WebSocket(`${URL_BASE}?${params}`, { headers });
  const messages = [];
  const waiters = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    messages.push(msg);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].match(msg)) {
        const [waiter] = waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      }
    }
  });
  const send = (type, data = {}, to = 'hub') => ws.send(JSON.stringify({ type, to, data }));
  const waitFor = (match, ms = 20000, label = '') => new Promise((resolve, reject) => {
    const hit = messages.find(match);
    if (hit) return resolve(hit);
    const timer = setTimeout(() => reject(new Error(`超时等待 ${label}`)), ms);
    waiters.push({ match, resolve, timer });
    return undefined;
  });
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('连接失败')));
  });
  const closed = new Promise((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
  return { ws, messages, send, waitFor, open, closed, close: () => ws.close() };
}

let seq = 0;
async function agentRequest(web, op, args = {}) {
  const reqId = `r${seq++}`;
  web.send('agent.request', { reqId, op, args });
  const result = await web.waitFor((m) => m.type === 'agent.result' && m.data?.reqId === reqId, 20000, `agent.result ${op}`);
  if (!result.data.ok) throw new Error(`${op} 失败：${result.data.error}`);
  return result.data.data;
}
async function agentFail(web, op, args = {}) {
  const reqId = `r${seq++}`;
  web.send('agent.request', { reqId, op, args });
  const result = await web.waitFor((m) => m.type === 'agent.result' && m.data?.reqId === reqId, 20000, `agent.result ${op}`);
  return result.data.ok ? '' : result.data.error;
}

// 假设备：收到 tool.call 就回一句话，记下收到的调用
function fakeDevice(id, name) {
  const device = client('desktop', { deviceId: id });
  device.calls = [];
  device.ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type !== 'tool.call') return;
    device.calls.push(msg.data);
    device.send('tool.result', { call_id: msg.data.call_id, result: { text: `${name} 跑了 ${msg.data.name}：${JSON.stringify(msg.data.arguments)}` } }, 'server');
  });
  device.report = (extra = {}) => device.send('device.report', {
    name, platform: 'darwin', arch: 'arm64', host: `${id}.local`, username: 'e2e', workdir: `/tmp/${id}`, browser: false, description: `${name} 的描述`, ...extra,
  }, 'server');
  return device;
}

/* ── 0. 电脑端鉴权：没带 / 带错令牌、没带 device_id 都被拒 ── */
for (const [label, opts] of [['令牌缺失', { deviceToken: '', deviceId: DEV_A }], ['令牌错误', { deviceToken: 'wrong', deviceId: DEV_A }], ['缺 device_id', {}]]) {
  const intruder = client('desktop', opts);
  const rejected = await intruder.open.then(() => false, () => true);
  check(`电脑端${label}被拒`, rejected);
  intruder.close();
}

/* ── 1. 两台设备接入 ── */
const devA = fakeDevice(DEV_A, '设备甲');
const devB = fakeDevice(DEV_B, '设备乙');
await Promise.all([devA.open, devB.open]);
const readyA = await devA.waitFor((m) => m.type === 'connection.ready', 5000, 'desktop ready');
check('电脑端 connection.ready 带 deviceId', readyA.data.deviceId === DEV_A);
devA.report();
devB.report();
await wait(400);

/* ── 2. 网页：错密码、对密码、令牌复用 ── */
const web = client('web');
await web.open;
const ready = await web.waitFor((m) => m.type === 'connection.ready', 5000, 'connection.ready');
check('未登录网页 connection.ready', ready.data.authenticated === false && ready.data.passwordSet === true);
web.send('agent.request', { reqId: 'pre', op: 'status.get', args: {} });
const blocked = await web.waitFor((m) => m.type === 'auth.state' && /密码/.test(m.data?.error || ''), 5000, '未登录拦截');
check('未登录请求被拦（只回 auth.state）', Boolean(blocked) && !web.messages.some((m) => m.type === 'agent.result' && m.data?.reqId === 'pre'));
web.send('auth.submit', { password: 'nope' });
const bad = await web.waitFor((m) => m.type === 'auth.state' && m.data?.error?.includes('密码错误'), 5000, '错密码');
check('错密码返回剩余次数', /剩余 \d+ 次/.test(bad.data.error), bad.data.error);
web.send('auth.submit', { password: PASSWORD });
const good = await web.waitFor((m) => m.type === 'auth.state' && m.data?.authenticated === true, 5000, '登录成功');
check('对密码登录并颁发令牌', typeof good.data.sessionToken === 'string' && good.data.sessionToken.length > 20);
const devicesMsg = await web.waitFor((m) => m.type === 'connection.devices', 5000, 'connection.devices');
const ids = devicesMsg.data.devices.map((d) => d.id);
check('登录后收到设备列表（两台在线）', ids.includes(DEV_A) && ids.includes(DEV_B) && devicesMsg.data.devices.filter((d) => d.online).length >= 2, ids.join(','));

const reuse = client('web', { authToken: good.data.sessionToken });
await reuse.open;
const reuseReady = await reuse.waitFor((m) => m.type === 'connection.ready', 5000, 'token ready');
check('令牌免密登录', reuseReady.data.authenticated === true);
reuse.close();

/* ── 3. 设备描述：电脑端上报只做初始值，云端改过之后以云端为准 ── */
const status = await agentRequest(web, 'status.get');
const a = status.devices.find((d) => d.id === DEV_A);
check('status.devices 带描述', a?.description === '设备甲 的描述', a?.description);
await agentRequest(web, 'devices.patch', { id: DEV_A, name: '甲号机', description: '云端改的描述' });
devA.report({ description: '电脑端又报了一遍' });
await wait(400);
const after = (await agentRequest(web, 'devices.list')).devices.find((d) => d.id === DEV_A);
check('云端描述不被电脑端上报覆盖', after.name === '甲号机' && after.description === '云端改的描述', `${after.name} / ${after.description}`);

/* ── 4. 配置 + 会话：默认设备 ── */
await agentRequest(web, 'config.put', { responsesUrl: 'http://127.0.0.1:9611/v1/responses', apiKey: 'sk-e2e', model: 'mock-model', workdir: '/tmp' });
const sessA = await agentRequest(web, 'sessions.create', { device_id: DEV_A });
check('sessions.create 指定设备', sessA.device_id === DEV_A);
const sessAuto = await agentRequest(web, 'sessions.create', {});
check('sessions.create 不指定则挑在线设备', [DEV_A, DEV_B].includes(sessAuto.device_id) || sessAuto.device_id !== '', sessAuto.device_id);
check('sessions.create 指定不存在的设备报错', /设备不存在/.test(await agentFail(web, 'sessions.create', { device_id: 'nope-device' })));
const patched = await agentRequest(web, 'sessions.patch', { id: sessAuto.id, device_id: DEV_B });
check('sessions.patch 改默认设备', patched.device_id === DEV_B);
const opened = await agentRequest(web, 'sessions.open', { id: sessAuto.id });
check('sessions.open 返回 device_id', opened.device_id === DEV_B);

/* ── 5. 工具路由：默认设备 / device 参数 / 不存在 / 离线 ── */
const events = (sid) => web.messages.filter((m) => m.type === 'agent.event' && m.data?.session_id === sid).map((m) => m.data);
async function runTurn(sid, outputs, text = 'go') {
  rounds.push(...outputs);
  const before = events(sid).filter((e) => e.type === 'done').length;
  await agentRequest(web, 'messages.send', { id: sid, text });
  await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === sid && m.data?.type === 'done'
    && events(sid).filter((e) => e.type === 'done').length > before, 30000, 'done');
  // 这个会话到目前为止所有工具结果（按顺序），调用方自己取最后几条。
  return events(sid).filter((e) => e.type === 'function_call_output' && e.item).map((e) => JSON.parse(e.item.output));
}

// 5a 不带 device → 会话默认设备甲
let outs = await runTurn(sessA.id, [
  round([call('c1', 'shell', { command: 'echo 1' })]),
  round([say('ok')]),
]);
check('不带 device 的工具在默认设备甲执行', devA.calls.length === 1 && devB.calls.length === 0 && outs.at(-1)?.text?.includes('设备甲'), outs.at(-1)?.text);
check('发给设备的参数里不含 device 字段', devA.calls[0] && !('device' in devA.calls[0].arguments));

// 5b 带 device=乙 → 乙执行；不存在 / 离线 → 失败且谁也不执行
outs = await runTurn(sessA.id, [
  round([
    call('c2', 'shell', { command: 'echo 2', device: DEV_B }),
    call('c3', 'read', { path: '/x', device: 'ghost-device' }),
  ]),
  round([say('ok')]),
]);
const last2 = outs.slice(-2);
check('device=乙 时乙执行', devB.calls.length === 1 && last2[0]?.success === true && last2[0]?.text?.includes('设备乙'), last2[0]?.text);
check('device 不存在时失败', last2[1]?.success === false && /设备不存在/.test(last2[1]?.text || ''), last2[1]?.text);
check('不存在的设备没有落到别的设备', devA.calls.length === 1 && devB.calls.length === 1);

// 5c 乙断开：指定乙的调用失败，同一轮里甲照常
devB.close();
await wait(500);
outs = await runTurn(sessA.id, [
  round([
    call('c4', 'shell', { command: 'echo 4', device: DEV_B }),
    call('c5', 'shell', { command: 'echo 5' }),
  ]),
  round([say('ok')]),
]);
const last3 = outs.slice(-2);
check('离线设备的工具失败并说明离线', last3[0]?.success === false && /离线/.test(last3[0]?.text || ''), last3[0]?.text);
check('同一轮里在线设备甲照常执行', last3[1]?.success === true && devA.calls.length === 2, last3[1]?.text);

// 5d 全部离线：模型只拿到 sql；设备工具直接失败
devA.close();
await wait(500);
const st2 = await agentRequest(web, 'status.get');
check('全部离线时 device_online=false', st2.device_online === false && st2.devices.every((d) => !d.online));
outs = await runTurn(sessA.id, [
  round([call('c6', 'shell', { command: 'echo 6' })]),
  round([say('设备不在')]),
]);
check('全部离线时工具失败不炸', outs.at(-1)?.success === false && /离线/.test(outs.at(-1)?.text || ''), outs.at(-1)?.text);

/* ── 6. 设备重连后 drain 只影响自己：甲回来，乙留着离线 ── */
const devA2 = fakeDevice(DEV_A, '设备甲');
await devA2.open;
devA2.report();
await wait(400);
const list = (await agentRequest(web, 'devices.list')).devices;
check('甲重连后在线、乙离线', list.find((d) => d.id === DEV_A)?.online === true && list.find((d) => d.id === DEV_B)?.online === false);
check('离线设备可删除登记，在线不行', /在线/.test(await agentFail(web, 'devices.remove', { id: DEV_A })));
await agentRequest(web, 'devices.remove', { id: DEV_B });
const sessAfter = await agentRequest(web, 'sessions.open', { id: sessAuto.id });
check('删除设备后绑定它的会话失去默认设备', sessAfter.device_id === '');

/* ── 7. 终端 / 文件消息按设备路由：网页发 device:<id>，设备回话带 meta.deviceId ── */
const termWait = devA2.waitFor((m) => m.type === 'terminal.list', 5000, 'terminal.list 到设备');
web.send('terminal.list', {}, `device:${DEV_A}`);
const gotTerm = await termWait.then(() => true, () => false);
check('网页 → device:<id> 路由到对应设备', gotTerm);
devA2.send('terminal.list', { terminals: [] }, 'web');
const back = await web.waitFor((m) => m.type === 'terminal.list' && m.meta?.deviceId === DEV_A, 5000, 'terminal.list 回网页');
check('设备 → 网页的消息带 meta.deviceId', back.meta.deviceId === DEV_A);
const noRoute = devA2.waitFor((m) => m.type === 'fs.home', 1500, 'fs.home').then(() => true, () => false);
web.send('fs.home', {}, `device:${DEV_B}`);
check('发给离线设备的消息不会串到别的设备', (await noRoute) === false);

/* ── 8. 同一设备重复连接：旧连接被替换 ── */
const dup = fakeDevice(DEV_A, '设备甲');
await dup.open;
const oldClosed = await Promise.race([devA2.closed, wait(3000).then(() => 'timeout')]);
check('同一 device_id 再连，旧连接被关（4002）', oldClosed === 4002, String(oldClosed));

/* ── 9. 停止（没在跑） ── */
const stop = await agentRequest(web, 'run.stop', { id: sessA.id });
check('run.stop 没在跑返回 false', stop.stopped === false);

/* ── 清理 ── */
await agentRequest(web, 'sessions.delete', { id: sessA.id });
await agentRequest(web, 'sessions.delete', { id: sessAuto.id });
dup.close();
web.close();
model.close();
log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);

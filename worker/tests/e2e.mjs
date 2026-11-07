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

/* ── 假模型：按顺序吐回合，记下收到的请求体 ── */
const rounds = [];
const requests = [];
const model = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  try { requests.push(JSON.parse(body)); } catch { requests.push(null); }
  const round = requests.at(-1)?.instructions?.includes('现在是任务状态通知触发的回复')
    ? { response: { status: 'completed', output: [say('已收到任务结果')] } }
    : rounds.shift();
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

/* ── 4. 配置 + 会话：会话不绑设备 ── */
await agentRequest(web, 'config.put', { responsesUrl: 'http://127.0.0.1:9611/v1/responses', apiKey: 'sk-e2e', model: 'mock-model', workdir: '/tmp' });
check('独立对话创建接口已关闭', /独立对话已移除/.test(await agentFail(web, 'sessions.create', {})));
const sessA = await agentRequest(web, 'router.open', {});
check('助理固定会话不绑定设备', sessA.id === 'router' && !('device_id' in sessA));
const opened = await agentRequest(web, 'sessions.open', { id: sessA.id });
check('sessions.open 不带设备字段', !('device_id' in opened));

/* ── 5. 工具路由：device 参数 / 多台在线不填 / 只剩一台不填 / 不存在 / 离线 ── */
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

// 助理只能安排任务与查云端数据，不能直接执行设备工具。
let outs = await runTurn(sessA.id, [
  round([call('no-shell', 'shell', { command: 'echo 0', device: DEV_A }),
    call('sql-check', 'sql', { sql: 'SELECT ? AS value', params: ['参数正常'] })]),
  round([say('ok')]),
]);
check('助理调用设备工具被拒绝', outs.at(-2)?.success === false && devA.calls.length === 0 && devB.calls.length === 0);
check('助理 SQL 正确保留绑定参数', /参数正常/.test(outs.at(-1)?.text || ''));
const prompt = requests.at(-1)?.instructions || '';
check('助理上下文有两台设备和描述', prompt.includes(DEV_A) && prompt.includes(DEV_B) && prompt.includes('云端改的描述'));
check('多台在线时手动创建必须指定设备', /必须在 device 参数里指定/.test(await agentFail(web, 'tasks.dispatch', { title: '选择设备验证', goal: '未选择设备' })));
check('不存在设备不能创建任务', /设备不存在/.test(await agentFail(web, 'tasks.dispatch', { title: '设备不存在验证', goal: '设备不存在', device: 'ghost-device' })));

async function runTask(device, outputs, goal = '手动创建并完成这个目标') {
  rounds.push(...outputs);
  const dispatched = await agentRequest(web, 'tasks.dispatch', { title: '手动任务验证', goal, ...(device ? { device } : {}) });
  await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === dispatched.task_id && m.data?.type === 'done', 30000, 'task done');
  // 等自动汇报收尾，下一次模型脚本不与助理争用。
  for (let i = 0; i < 100; i++) {
    const history = await agentRequest(web, 'sessions.open', { id: 'router' });
    if (!history.running && history.messages.some((m) => m.task_id === dispatched.task_id)) break;
    await wait(50);
  }
  return dispatched.task_id;
}
const firstGoal = '手动创建的完整目标，完成后需要自动通知助理';
const taskA = await runTask(DEV_A, [
  round([call('a-shell', 'shell', { command: 'echo 1', device: DEV_B })]),
  round([say('甲已完成')]),
], firstGoal);
check('手动任务固定在甲执行，忽略工具里的其他设备', devA.calls.length === 1 && devB.calls.length === 0);
check('发给设备的参数不含 device 字段', !('device' in devA.calls[0].arguments));
const taskRequest = requests.find((r) => r.instructions?.includes(firstGoal));
check('任务首轮输入保存完整目标', taskRequest?.input?.[0]?.content?.[0]?.text === firstGoal);
check('任务工具无 device 选择和云端 SQL', taskRequest.tools.every((tool) => !tool.parameters?.properties?.device && tool.name !== 'sql'));
const taskB = await runTask(DEV_B, [round([call('b-shell', 'shell', { command: 'echo 2' })]), round([say('乙已完成')])]);
check('选择乙的手动任务在乙执行', devB.calls.length === 1);

devB.close();
await wait(500);
check('离线设备不能创建任务', /离线/.test(await agentFail(web, 'tasks.dispatch', { title: '离线验证', goal: '离线设备', device: DEV_B })));
const taskDefault = await runTask('', [round([call('default-shell', 'shell', { command: 'echo 3' })]), round([say('唯一设备已完成')])]);
check('只有甲在线时可自动选择甲', devA.calls.length === 2 && devB.calls.length === 1);
devA.close();
await wait(500);
const st2 = await agentRequest(web, 'status.get');
check('全部离线时状态正确', st2.device_online === false && st2.devices.every((d) => !d.online));
check('全部离线时不能创建任务', /离线/.test(await agentFail(web, 'tasks.dispatch', { title: '无设备验证', goal: '无在线设备' })));
await runTurn(sessA.id, [round([say('可以继续交谈，执行任务需要在线设备')])]);
check('全部设备离线时仍能与助理交谈', events(sessA.id).some((e) => e.item?.content?.[0]?.text?.includes('可以继续交谈')));
for (const id of [taskA, taskB, taskDefault]) await agentRequest(web, 'sessions.delete', { id });

/* ── 6. 设备重连后 drain 只影响自己：甲回来，乙留着离线 ── */
const devA2 = fakeDevice(DEV_A, '设备甲');
await devA2.open;
devA2.report();
await wait(400);
const list = (await agentRequest(web, 'devices.list')).devices;
check('甲重连后在线、乙离线', list.find((d) => d.id === DEV_A)?.online === true && list.find((d) => d.id === DEV_B)?.online === false);
check('离线设备可删除登记，在线不行', /在线/.test(await agentFail(web, 'devices.remove', { id: DEV_A })));
await agentRequest(web, 'devices.remove', { id: DEV_B });
const listAfter = (await agentRequest(web, 'devices.list')).devices;
check('删除离线设备的登记', !listAfter.some((d) => d.id === DEV_B));

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
dup.close();
web.close();
model.close();
log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);

// 真实运行时联调：wrangler dev（本地 D1 + R2 + DO）+ 假模型 HTTP + 假设备 WS。
// 前提：dev 已起在 9507，并且已用 schema.sql 初始化本地 D1。
import http from 'node:http';

const PORT = Number(process.env.PORT || 9507);
const SESSION = 'e2e';
// 和 wrangler dev 的 --var DEVICE_TOKEN 一致
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || 'e2e-token';
const URL_BASE = `ws://127.0.0.1:${PORT}/ws?session=${SESSION}`;

const log = (...args) => console.log(...args);

/* ── 假模型：两轮，先调 shell 再收尾 ── */
const rounds = [
  {
    events: [{ type: 'response.output_text.delta', delta: '我查一下' }],
    response: {
      status: 'completed',
      output: [{ type: 'function_call', call_id: 'call_1', name: 'shell', arguments: JSON.stringify({ command: 'echo hi-from-e2e' }) }],
      usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 },
    },
  },
  {
    events: [{ type: 'response.output_text.delta', delta: '跑完了' }],
    response: {
      status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '设备回了 hi-from-e2e' }] }],
      usage: { input_tokens: 200, output_tokens: 8, total_tokens: 208 },
    },
  },
];
const model = http.createServer((req, res) => {
  const round = rounds.shift();
  if (!round) {
    res.writeHead(500).end('no more rounds');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of round.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'response.completed', response: round.response })}\n\n`);
  res.end();
});
await new Promise((r) => model.listen(9611, '127.0.0.1', r));

/* ── WS 客户端 ── */
function client(device, { authToken = '', deviceToken = DEVICE_TOKEN } = {}) {
  const url = `${URL_BASE}&device=${device}${authToken ? `&authToken=${authToken}` : ''}`;
  const headers = device === 'desktop' && deviceToken ? { authorization: `Bearer ${deviceToken}` } : {};
  const ws = new WebSocket(url, { headers });
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
  const send = (type, data = {}, to = device) => ws.send(JSON.stringify({ type, to, data }));
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
  return { ws, messages, send, waitFor, open, close: () => ws.close() };
}

async function agentRequest(web, reqId, op, args) {
  web.send('agent.request', { reqId, op, args }, 'desktop');
  const result = await web.waitFor((m) => m.type === 'agent.result' && m.data?.reqId === reqId, 20000, `agent.result ${op}`);
  if (!result.data.ok) throw new Error(`${op} 失败：${result.data.error}`);
  return result.data.data;
}

/* ── 0. 没带或带错令牌的电脑端被拒 ── */
for (const deviceToken of ['', 'wrong-token']) {
  const intruder = client('desktop', { deviceToken });
  const rejected = await intruder.open.then(() => false, () => true);
  log(`电脑端令牌${deviceToken ? '错误' : '缺失'}被拒:`, rejected);
  intruder.close();
}

/* ── 1. 设备接入、关掉密码 ── */
const device = client('desktop');
await device.open;
device.send('auth.mode', { requiresPassword: false });
device.send('device.report', {
  id: 'desktop', name: 'e2e 假设备', platform: 'darwin', arch: 'arm64',
  host: 'e2e.local', username: 'e2e', workdir: '/tmp', browser: true,
});
await new Promise((r) => setTimeout(r, 300));

/* ── 2. web 接入 ── */
const web = client('web');
await web.open;
const ready = await web.waitFor((m) => m.type === 'connection.ready', 5000, 'connection.ready');
log('web 连接:', ready.data);
await new Promise((r) => setTimeout(r, 200));

/* ── 3. 配置 + 会话 ── */
await agentRequest(web, 'cfg', 'config.put', {
  responsesUrl: 'http://127.0.0.1:9611/v1/responses',
  apiKey: 'sk-e2e',
  model: 'mock-model',
  workdir: '/tmp',
});
const status = await agentRequest(web, 'st', 'status.get', {});
log('status:', { model_ready: status.model_ready, device_online: status.device_online, browser: status.browser_connected, workdir: status.workdir });

/* ── 4. 图片往返 ── */
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const created = await agentRequest(web, 'new', 'sessions.create', {});
const sid = created.id || created.session?.id;
const uploaded = await agentRequest(web, 'up', 'images.upload', { id: sid, image: png });
const fetched = await agentRequest(web, 'get', 'images.get', { url: uploaded.url });
log('图片:', { url: uploaded.url, size: uploaded.size, roundtrip: `data:${fetched.type};base64,${fetched.data}` === png });
const imageHttp = await fetch(`http://127.0.0.1:${PORT}${uploaded.url}`);
log('图片 HTTP:', { status: imageHttp.status, type: imageHttp.headers.get('content-type'), bytes: (await imageHttp.arrayBuffer()).byteLength });

/* ── 5. 发消息：模型 → tool.call → 设备跑 shell → tool.result → 收尾 ── */
const toolCalls = [];
const deviceLoop = (async () => {
  const call = await device.waitFor((m) => m.type === 'tool.call', 20000, 'tool.call');
  toolCalls.push(call.data);
  device.send('tool.result', {
    call_id: call.data.call_id,
    result: { text: `hi-from-e2e\n(workdir=${call.data.config?.workdir})` },
  });
})();

await agentRequest(web, 'send', 'messages.send', { id: sid, text: '跑一下 echo', images: [uploaded.url] });
await deviceLoop;

const events = () => web.messages.filter((m) => m.type === 'agent.event' && m.data?.session_id === sid).map((m) => m.data);
const done = await web.waitFor((m) => m.type === 'agent.event' && m.data?.type === 'done', 30000, 'done');
log('工具调用参数:', toolCalls[0]?.config);
log('事件序列:', events().map((e) => `${e.type}${e.item ? `:${e.item.type}` : ''}${e.status ? `:${e.status}` : ''}`));
log('done:', done.data);

const opened = await agentRequest(web, 'open', 'sessions.open', { id: sid });
log('落库消息:', opened.messages.map((m) => `${m.item.type}${m.usage ? ` usage=${m.usage.total_tokens}` : ''}`));
log('线程里带图片的消息:', opened.messages.some((m) => JSON.stringify(m.item).includes('/api/images/')));

/* ── 6. 设备离线时工具失败但不炸 ── */
device.close();
await new Promise((r) => setTimeout(r, 500));
rounds.push({
  events: [],
  response: {
    status: 'completed',
    output: [{ type: 'function_call', call_id: 'call_2', name: 'shell', arguments: JSON.stringify({ command: 'echo x' }) }],
  },
});
rounds.push({
  events: [],
  response: {
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '设备不在，先不跑了' }] }],
  },
});
await agentRequest(web, 'send2', 'messages.send', { id: sid, text: '再跑一次' });
const doneBefore = events().filter((e) => e.type === 'done').length;
const offline = await new Promise((resolve) => {
  const timer = setInterval(() => {
    const hit = events().filter((e) => e.type === 'done')[doneBefore];
    if (hit) {
      clearInterval(timer);
      resolve(hit);
    }
  }, 100);
  setTimeout(() => { clearInterval(timer); resolve(null); }, 30000);
});
log('离线那一轮:', offline?.status);
const reopened = await agentRequest(web, 'open2', 'sessions.open', { id: sid });
log('离线工具结果:', reopened.messages.filter((m) => m.item.type === 'function_call_output').slice(-1)[0]?.item.output);

/* ── 7. 停止 ── */
const stop = await agentRequest(web, 'stop', 'run.stop', { id: sid });
log('停止（没在跑）:', stop);

web.close();
model.close();

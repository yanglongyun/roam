// 补充联调：密码开启时的拦截、运行中停止
import http from 'node:http';

const PORT = 9507;
const SESSION = `x${Date.now() % 10000}`;
const OTHER = `${SESSION}-new`;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || 'e2e-token';
let slow = false;

const model = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (slow) {
    res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '想很久' })}\n\n`);
    return; // 挂着不结束
  }
  res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }] } })}\n\n`);
  res.end();
});
await new Promise((r) => model.listen(9612, '127.0.0.1', r));

function client(device, authToken = '', session = SESSION) {
  const headers = device === 'desktop' ? { authorization: `Bearer ${DEVICE_TOKEN}` } : {};
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?session=${session}&device=${device}${authToken ? `&authToken=${authToken}` : ''}`, { headers });
  const messages = [];
  const ready = new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data)));
  return { ws, messages, ready, send: (type, data = {}, to = device) => ws.send(JSON.stringify({ type, to, data })) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const request = async (web, id, op, args) => {
  web.send('agent.request', { reqId: id, op, args }, 'desktop');
  for (let i = 0; i < 200; i += 1) {
    const hit = web.messages.find((m) => m.type === 'agent.result' && m.data?.reqId === id);
    if (hit) return hit.data;
    await wait(50);
  }
  return { ok: false, error: '超时' };
};

const device = client('desktop');
await device.ready;
device.send('auth.mode', { requiresPassword: true });
device.send('device.report', { id: 'desktop', name: 'x', platform: 'darwin', arch: 'arm64', host: 'h', username: 'u', workdir: '/tmp' });
await wait(300);

// 1. 密码开启后，未认证的 web 连上就被拦
const web = client('web');
await web.ready;
await wait(300);
console.log('未认证连接:', web.messages.find((m) => m.type === 'connection.ready')?.data);
console.log('未认证请求:', (await request(web, 'a', 'status.get', {})).error);

// 2. 设备放行 → 免密码
device.send('auth.mode', { requiresPassword: false });
await wait(300);
console.log('放行后 status:', (await request(web, 'b', 'status.get', {})).ok);

await request(web, 'c', 'config.put', { responsesUrl: 'http://127.0.0.1:9612/v1/responses', apiKey: 'sk', model: 'm', workdir: '/tmp' });
const sid = (await request(web, 'd', 'sessions.create', {})).data.id;

// 3. 运行到一半停止
slow = true;
console.log('发送:', (await request(web, 'e', 'messages.send', { id: sid, text: '慢一点' })).ok);
await wait(800);
const running = await request(web, 'f', 'sessions.open', { id: sid });
console.log('运行中:', running.data.running);
console.log('停止:', await request(web, 'g', 'run.stop', { id: sid }));
await wait(300);
const events = web.messages.filter((m) => m.type === 'agent.event' && m.data?.session_id === sid).map((m) => m.data);
console.log('事件:', events.map((e) => `${e.type}${e.status ? ':' + e.status : ''}`));
console.log('停止后 running:', (await request(web, 'h', 'sessions.open', { id: sid })).data.running);

// 4. 停止后再发能正常跑
slow = false;
console.log('再发:', (await request(web, 'i', 'messages.send', { id: sid, text: '继续' })).ok);
await wait(1500);
console.log('最终事件:', web.messages.filter((m) => m.type === 'agent.event' && m.data?.session_id === sid).map((m) => `${m.data.type}${m.data.status ? ':' + m.data.status : ''}`).slice(-3));

// 5. 电脑端换到新 session 后，旧 session 的网页碰不到云端数据；换回来又能用
const moved = client('desktop', '', OTHER);
await moved.ready;
await wait(300);
console.log('电脑端换 session 后旧链接:', (await request(web, 'j', 'sessions.list', {})).error);
moved.ws.close();
const back = client('desktop');
await back.ready;
await wait(300);
console.log('电脑端换回来后旧链接:', (await request(web, 'k', 'sessions.list', {})).ok);

// 6. 换密码：之前发出的免密令牌作废，已登录的网页要重新输密码
back.send('auth.mode', { requiresPassword: true, fingerprint: 'old-password' });
await wait(300);
const login = client('web');
await login.ready;
await wait(300);
const loginId = login.messages.find((m) => m.type === 'connection.ready')?.data.clientId;
back.send('auth.grant', { clientId: loginId });
await wait(300);
const token = login.messages.find((m) => m.type === 'auth.state' && m.data?.sessionToken)?.data.sessionToken;
const reuse = client('web', token);
await reuse.ready;
await wait(300);
console.log('同一密码下令牌免登录:', reuse.messages.find((m) => m.type === 'connection.ready')?.data.authenticated);
back.send('auth.mode', { requiresPassword: true, fingerprint: 'new-password' });
await wait(300);
console.log('换密码后已登录网页:', login.messages.filter((m) => m.type === 'auth.state').at(-1)?.data.authenticated);
const stale = client('web', token);
await stale.ready;
await wait(300);
console.log('换密码后旧令牌:', stale.messages.find((m) => m.type === 'connection.ready')?.data.authenticated);
process.exit(0);

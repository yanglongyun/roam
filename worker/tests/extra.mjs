// 补充联调：密码开启时的拦截、运行中停止
import http from 'node:http';

const PORT = 9507;
const SESSION = `x${Date.now() % 10000}`;
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

function client(device, authToken = '') {
  const headers = device === 'desktop' ? { authorization: `Bearer ${DEVICE_TOKEN}` } : {};
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?session=${SESSION}&device=${device}${authToken ? `&authToken=${authToken}` : ''}`, { headers });
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
process.exit(0);

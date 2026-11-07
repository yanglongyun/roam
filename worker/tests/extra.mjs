// 补充联调：密码锁定、运行中停止、没设密码时拒绝网页。
// 前提同 e2e.mjs。锁定测试会把 hub 锁 30 分钟（只影响本地 dev 的 DO 存储），所以放在最后。
import http from 'node:http';

const PORT = Number(process.env.PORT || 9507);
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || 'e2e-token';
const PASSWORD = process.env.ACCESS_PASSWORD || 'e2e-pass';
const DEV = `x-${Date.now().toString(36)}`;
let slow = false;
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `：${detail}` : ''}`);
  if (!ok) failures += 1;
};

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

function client(kind, { authToken = '', deviceId = '' } = {}) {
  const params = new URLSearchParams({ device: kind });
  if (authToken) params.set('authToken', authToken);
  if (deviceId) params.set('device_id', deviceId);
  const headers = kind === 'desktop' ? { authorization: `Bearer ${DEVICE_TOKEN}` } : {};
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?${params}`, { headers });
  const messages = [];
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const closed = new Promise((r) => ws.addEventListener('close', (e) => r(e.code)));
  ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data)));
  return { ws, messages, ready, closed, send: (type, data = {}, to = 'hub') => ws.send(JSON.stringify({ type, to, data })) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const request = async (web, id, op, args) => {
  web.send('agent.request', { reqId: id, op, args });
  for (let i = 0; i < 200; i += 1) {
    const hit = web.messages.find((m) => m.type === 'agent.result' && m.data?.reqId === id);
    if (hit) return hit.data;
    await wait(50);
  }
  return { ok: false, error: '超时' };
};
async function login(web) {
  web.send('auth.submit', { password: PASSWORD });
  for (let i = 0; i < 100; i += 1) {
    if (web.messages.some((m) => m.type === 'auth.state' && m.data?.authenticated)) return true;
    await wait(50);
  }
  return false;
}

const device = client('desktop', { deviceId: DEV });
await device.ready;
device.send('device.report', { name: 'x', platform: 'darwin', arch: 'arm64', host: 'h', username: 'u', workdir: '/tmp' }, 'server');
await wait(300);

// 1. 未登录的网页请求被拦
const web = client('web');
await web.ready;
await wait(300);
check('未登录 connection.ready.authenticated=false', web.messages.find((m) => m.type === 'connection.ready')?.data.authenticated === false);
const blocked = await request(web, 'a', 'status.get', {});
check('未登录请求拿不到结果', blocked.error === '超时' && web.messages.some((m) => m.type === 'auth.state' && /密码/.test(m.data?.error || '')));

// 2. 登录
check('密码登录', await login(web));
check('登录后 status.get', (await request(web, 'b', 'status.get', {})).ok);

await request(web, 'c', 'config.put', { responsesUrl: 'http://127.0.0.1:9612/v1/responses', apiKey: 'sk', model: 'm', workdir: '/tmp' });
const sid = (await request(web, 'd', 'router.open', {})).data.id;

// 3. 运行到一半停止
slow = true;
check('发送', (await request(web, 'e', 'messages.send', { id: sid, text: '慢一点' })).ok);
await wait(800);
const running = await request(web, 'f', 'sessions.open', { id: sid });
check('运行中', running.data.running === true);
const stopped = await request(web, 'g', 'run.stop', { id: sid });
check('停止', stopped.ok && stopped.data.stopped === true);
await wait(300);
const events = web.messages.filter((m) => m.type === 'agent.event' && m.data?.session_id === sid).map((m) => m.data);
check('停止后 done:aborted', events.some((e) => e.type === 'done' && e.status === 'aborted'), events.map((e) => `${e.type}${e.status ? ':' + e.status : ''}`).join(' '));
check('停止后 running=false', (await request(web, 'h', 'sessions.open', { id: sid })).data.running === false);

// 4. 停止后再发能正常跑
slow = false;
check('再发', (await request(web, 'i', 'messages.send', { id: sid, text: '继续' })).ok);
await wait(1500);
const tail = web.messages.filter((m) => m.type === 'agent.event' && m.data?.session_id === sid).map((m) => `${m.data.type}${m.data.status ? ':' + m.data.status : ''}`).slice(-2);
check('最终 done:completed', tail.at(-1) === 'done:completed', tail.join(' '));
await request(web, 'j', 'sessions.delete', { id: sid });

// 5. 多个网页同时在线互不踢
const second = client('web');
await second.ready;
check('第二个网页登录', await login(second));
await wait(300);
check('第一个网页没被踢', web.ws.readyState === WebSocket.OPEN && (await request(web, 'k', 'status.get', {})).ok);
second.ws.close();

// 6. 连续错密码 → 锁定 → 已发令牌作废
const token = web.messages.find((m) => m.type === 'auth.state' && m.data?.sessionToken)?.data.sessionToken;
const attacker = client('web');
await attacker.ready;
for (let i = 0; i < 10; i += 1) {
  attacker.send('auth.submit', { password: `wrong-${i}` });
  await wait(120);
}
const code = await Promise.race([attacker.closed, wait(3000).then(() => 'open')]);
check('错 10 次后连接被关（4003）', code === 4003, String(code));
check('锁定提示', attacker.messages.some((m) => m.type === 'auth.state' && m.data?.closed && /分钟/.test(m.data.error)));
const stale = client('web', { authToken: token });
await stale.ready;
await wait(300);
check('锁定后旧令牌作废', stale.messages.find((m) => m.type === 'connection.ready')?.data.authenticated === false);
stale.ws.close();
const locked = client('web');
await locked.ready;
locked.send('auth.submit', { password: PASSWORD });
await wait(300);
check('锁定期间对密码也进不去', locked.messages.some((m) => m.type === 'auth.state' && m.data?.closed));

device.ws.close();
web.ws.close();
model.close();
console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);

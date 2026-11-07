// 计费联调：一次真实回复带 usage，检查消息上的 cost 和 usage.stats 的汇总。
// 前提同 e2e.mjs（本地 dev 起在 9507，假模型监听 9613）。
import http from 'node:http';

const PORT = Number(process.env.PORT || 9507);
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || 'e2e-token';
const PASSWORD = process.env.ACCESS_PASSWORD || 'e2e-pass';
const DEV = `bill-${Date.now().toString(36)}`;
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `：${detail}` : ''}`);
  if (!ok) failures += 1;
};

// 一次调用：输入 1M（其中 400k 命中缓存）、输出 100k。
const USAGE = {
  input_tokens: 1_000_000,
  input_tokens_details: { cached_tokens: 400_000 },
  output_tokens: 100_000,
  total_tokens: 1_100_000,
};
const model = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }], usage: USAGE } })}\n\n`);
  res.end();
});
await new Promise((r) => model.listen(9613, '127.0.0.1', r));

function client(kind, { deviceId = '' } = {}) {
  const params = new URLSearchParams({ device: kind });
  if (deviceId) params.set('device_id', deviceId);
  const headers = kind === 'desktop' ? { authorization: `Bearer ${DEVICE_TOKEN}` } : {};
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?${params}`, { headers });
  const messages = [];
  const ready = new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data)));
  return { ws, messages, ready, send: (type, data = {}, to = 'hub') => ws.send(JSON.stringify({ type, to, data })) };
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
device.send('device.report', { name: '计费机', platform: 'darwin', arch: 'arm64', host: 'h', username: 'u', workdir: '/tmp' }, 'server');
await wait(300);

const web = client('web');
await web.ready;
check('密码登录', await login(web));

// 模型指向假服务，单价用默认表里的 deepseek-flash。
const put = await request(web, 'c1', 'config.put', {
  responsesUrl: 'http://127.0.0.1:9613/v1/responses',
  apiKey: 'e2e-key',
  model: 'deepseek-flash',
});
check('配置模型地址', put.data?.saved === true, put.error || '');

const created = await request(web, 'c2', 'router.open', {});
const sessionId = created.data?.id;
check('建会话', Boolean(sessionId), created.error || '');

const sent = await request(web, 'c3', 'messages.send', { id: sessionId, text: '你好' });
let usageEvent;
for (let i = 0; i < 200; i += 1) {
  usageEvent = web.messages.find((m) => m.type === 'agent.event' && m.data?.type === 'usage'
    && m.data.usage?.input_tokens === 1_000_000);
  if (usageEvent) break;
  await wait(50);
}
const liveCost = usageEvent?.data?.cost;
check('实时 usage 事件带金额', Boolean(liveCost) && liveCost.tokens === 1_100_000, JSON.stringify(liveCost));
check('实时金额按单价算（600k 输入 + 400k 缓存 + 100k 输出）', (() => {
  if (!liveCost) return false;
  // 缓存命中的那 400k 按缓存价，其余 600k 按输入价；输出 100k 按输出价。
  const expected = liveCost.peak
    ? 600_000 * 0.3 + 400_000 * 0.006 + 100_000 * 1.2
    : 600_000 * 0.15 + 400_000 * 0.003 + 100_000 * 0.6;
  return Math.abs(liveCost.amount - expected / 1_000_000) < 1e-9;
})(), String(liveCost?.amount));

await wait(800);
const opened = await request(web, 'c4', 'sessions.open', { id: sessionId });
const withUsage = (opened.data?.messages || []).filter((m) => m.usage && m.id >= sent.data.id);
check('历史消息带 usage', withUsage.length >= 1);
check('历史消息带 cost', withUsage.every((m) => m.cost && m.cost.currency), JSON.stringify(withUsage[0]?.cost));
check('usage 里记下了模型名', withUsage.every((m) => m.usage.model === 'deepseek-flash'));

const stats = await request(web, 'c5', 'usage.stats', { tz_offset: 480 });
const data = stats.data || {};
check('usage.stats 返回今日/本月/合计', Boolean(data.today && data.month && data.all), stats.error || '');
check('合计次数与 token 对得上', data.all?.calls >= 1 && data.all?.tokens >= 1_100_000, JSON.stringify(data.all));
check('按模型分组里有 deepseek-flash', (data.by_model || []).some((m) => m.model === 'deepseek-flash'));
check('按天有 14 条', (data.by_day || []).length === 14);
check('合计金额不少于这次调用', (data.all?.cost || 0) >= (liveCost?.amount || 0) - 1e-6, `${data.all?.cost}`);
check('非法时区被拒', (await request(web, 'c6', 'usage.stats', { tz_offset: 9999 })).ok === false);

await request(web, 'cleanup', 'sessions.delete', { id: sessionId });

console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);

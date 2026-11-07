// 联调：助理派任务 → 任务在绑定的设备上跑 → 汇报 → 结束 / 追加指令 / 取消 / 预算超限。
// 前提同 e2e.mjs（dev 起在 9507，本地 D1 已用 schema.sql 初始化）。
//   npx wrangler d1 execute roam --local --file=server/agent/schema.sql
//   npx wrangler dev --port 9507 --var SETTINGS_KEY:dev --var DEVICE_TOKEN:e2e-token --var ACCESS_PASSWORD:e2e-pass
import http from 'node:http';

const PORT = Number(process.env.PORT || 9507);
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || 'e2e-token';
const PASSWORD = process.env.ACCESS_PASSWORD || 'e2e-pass';
const URL_BASE = `ws://127.0.0.1:${PORT}/ws`;
const DEV = `task-dev-${Date.now().toString(36)}`;

const log = (...args) => console.log(...args);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, ok, detail = '') {
  log(`${ok ? '✓' : '✗'} ${label}${detail ? `：${detail}` : ''}`);
  if (!ok) failures += 1;
}

/* ── 假模型：按角色分两条队列。助理的请求看提示词里"助理"那段，任务看"独立完成这件任务"。 ── */
const queues = { router: [], task: [], chat: [] };
const requests = [];
const model = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* 保持 null */ }
  const instructions = parsed?.instructions || '';
  const role = instructions.includes('现在是任务状态通知触发的回复')
    ? 'notification'
    : instructions.includes('你要独立完成这件任务')
    ? 'task'
    : instructions.includes('你是运行在云端的助理')
      ? 'router'
      : 'chat';
  requests.push({ role, instructions, body: parsed });
  // 真实接口会拒绝没有任何输入消息的任务，不能只凭 system prompt 开始。
  if (!Array.isArray(parsed?.input) || parsed.input.length === 0) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'input must not be empty' } }));
    return;
  }
  const round = role === 'notification'
    ? { response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '已收到任务结果' }] }] } }
    : queues[role].shift();
  if (!round) {
    res.writeHead(500).end('no more rounds');
    return;
  }
  if (round.error) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: round.error } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of round.events || []) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'response.completed', response: round.response })}\n\n`);
  res.end();
});
await new Promise((r) => model.listen(9612, '127.0.0.1', r));

const call = (id, name, args) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
const say = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const round = (output, usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }) => ({
  response: { status: 'completed', output, usage },
});

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
  return { ws, messages, send, waitFor, open, close: () => ws.close() };
}

let seq = 0;
async function agentRequest(web, op, args = {}, ms = 30000, attempts = 0) {
  const reqId = `t${seq++}`;
  web.send('agent.request', { reqId, op, args });
  const result = await web.waitFor((m) => m.type === 'agent.result' && m.data?.reqId === reqId, ms, `agent.result ${op}`);
  if (!result.data.ok) {
    // 自动汇报可能刚好占用助理；模拟界面等待它收尾后再发用户消息。
    if (attempts < 50 && op === 'messages.send' && args.id === 'router' && /会话正在回复/.test(result.data.error)) {
      await wait(100);
      return agentRequest(web, op, args, ms, attempts + 1);
    }
    throw new Error(`${op} 失败：${result.data.error}`);
  }
  return result.data.data;
}
async function agentFail(web, op, args = {}) {
  const reqId = `t${seq++}`;
  web.send('agent.request', { reqId, op, args });
  const result = await web.waitFor((m) => m.type === 'agent.result' && m.data?.reqId === reqId, 20000, `agent.result ${op}`);
  return result.data.ok ? '' : result.data.error;
}

const events = (web, sid) => web.messages.filter((m) => m.type === 'agent.event' && m.data?.session_id === sid).map((m) => m.data);
const doneCount = (web, sid) => events(web, sid).filter((e) => e.type === 'done' && !e.trigger).length;

// 发一句话并等到这一轮结束（done 事件的条数涨了）。
async function runTurn(web, sid, outputs, role, text = 'go') {
  queues[role].push(...outputs);
  const before = doneCount(web, sid);
  await agentRequest(web, 'messages.send', { id: sid, text });
  await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === sid && m.data?.type === 'done'
    && doneCount(web, sid) > before, 30000, `done ${sid}`);
  await wait(150);
}

// 等一个任务跑完（可能已经开始跑了，所以先看有没有 done）。
async function waitTask(web, sid, ms = 30000) {
  await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === sid && m.data?.type === 'done', ms, `task done ${sid}`);
  await wait(200);
}

/* ── 设备 + 网页登录 ── */
const dev = client('desktop', { deviceId: DEV });
await dev.open;
dev.ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type !== 'tool.call') return;
  dev.send('tool.result', { call_id: msg.data.call_id, result: { text: `设备跑了 ${msg.data.name}：${JSON.stringify(msg.data.arguments)}` } }, 'server');
});
const calls = [];
dev.ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'tool.call') calls.push(msg.data);
});
dev.send('device.report', {
  name: '干活机', platform: 'darwin', arch: 'arm64', host: `${DEV}.local`, username: 'task', workdir: '/tmp/task', browser: false, description: '派活用的机器',
}, 'server');

const web = client('web');
await web.open;
await web.waitFor((m) => m.type === 'connection.ready', 5000, 'ready');
web.send('auth.submit', { password: PASSWORD });
const auth = await web.waitFor((m) => m.type === 'auth.state' && m.data?.authenticated === true, 5000, '登录');
check('网页登录', typeof auth.data.sessionToken === 'string');

await agentRequest(web, 'config.put', {
  // 用定价表里有的模型名，任务上才能累加出金额。
  responsesUrl: 'http://127.0.0.1:9612/v1/responses', apiKey: 'sk-task', model: 'gpt-4o-mini', workdir: '/tmp',
});
const config = await agentRequest(web, 'config.get');
const routerSystem = config.router_system + '\n助理提示词保存回归。';
const taskSystem = config.task_system + '\n任务提示词保存回归。';
await agentRequest(web, 'config.put', { router_system: routerSystem, task_system: taskSystem });
const savedConfig = await agentRequest(web, 'config.get');
check('设置可保存助理与任务提示词', savedConfig.router_system === routerSystem && savedConfig.task_system === taskSystem);
await wait(300);

/* ── 0. 助理会话固定 id，且不出现在对话列表里 ── */
const router = await agentRequest(web, 'router.open');
check('router.open 返回固定会话', router.id === 'router', router.id);
const again = await agentRequest(web, 'router.open');
check('router.open 幂等', again.id === 'router');
const list0 = await agentRequest(web, 'sessions.list');
check('助理会话不在对话列表里', !list0.sessions.some((s) => s.id === 'router'));

/* ── 1. 助理派任务：立即返回、任务在绑定设备上跑、跑完写进度 ── */
const goal = '在 /tmp/task 里补一行 README。' + '保留原有内容和格式，只做这一项改动。'.repeat(4) + '\n验收：确认文件最后一行是 hi。';
queues.router.push(round([call('d1', 'dispatch_task', { title: '补充 README', goal, device: DEV, budget: { steps: 8 } })]));
queues.router.push(round([say('已派出去，任务 id 我记下了')]));
queues.task.push(round([call('k1', 'shell', { command: 'echo hi > README' })]));
queues.task.push(round([call('k2', 'report', { progress: 'README 补好了' })]));
queues.task.push(round([say('改完了，README 多了一行')]));

const beforeRouter = doneCount(web, 'router');
await agentRequest(web, 'messages.send', { id: 'router', text: '把 README 补一行' });
await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === 'router' && m.data?.type === 'done'
  && doneCount(web, 'router') > beforeRouter, 30000, 'router done');
// 工具结果的外层是 {success, text}，任务信息在 text 里的 JSON。
const rawOuts = events(web, 'router').filter((e) => e.type === 'function_call_output' && e.item).map((e) => e.item.output);
if (process.env.DEBUG) log('router 工具结果：', rawOuts);
const unwrap = (raw) => {
  try {
    const outer = JSON.parse(raw);
    const inner = JSON.parse(outer.text || '{}');
    return { ...outer, ...inner };
  } catch {
    return {};
  }
};
const dispatched = rawOuts.map(unwrap).filter((out) => out.task_id);
check('助理拿到任务 id', dispatched.length === 1 && typeof dispatched[0].task_id === 'string', JSON.stringify(dispatched[0] || {}));
const taskId = dispatched[0]?.task_id;

const listed = (await agentRequest(web, 'tasks.list')).tasks;
const task = listed.find((t) => t.id === taskId);
check('任务出现在任务列表（排队 / 执行中）', Boolean(task) && ['queued', 'running'].includes(task.status), task?.status);
check('任务绑在指定设备上', task?.device_id === DEV, task?.device_id);
check('任务目标保留完整验收标准', task?.goal === goal, task?.goal);
check('助理派发的短标题与长目标分别保存', task?.title === '补充 README' && task?.title !== task?.goal, task?.title);
const list1 = await agentRequest(web, 'sessions.list');
check('任务的会话不出现在对话列表里', !list1.sessions.some((s) => s.id === taskId));

await waitTask(web, taskId);
const done1 = await agentRequest(web, 'tasks.get', { id: taskId });
check('任务跑完状态是 done', done1.task.status === 'done', done1.task.status);
if (done1.task.status !== 'done') {
  log('任务失败详情：', done1.task.progress, events(web, taskId).filter((e) => e.type === 'error'));
  dev.close();
  web.close();
  model.close();
  process.exit(1);
}
const firstTask = requests.find((r) => r.role === 'task');
check('第一轮模型请求包含完整目标消息', firstTask?.body.input?.[0]?.role === 'user'
  && firstTask.body.input[0].content?.[0]?.text === goal);
check('任务提示词保留目标末尾的验收标准', firstTask?.instructions.includes(goal));
check('任务使用保存的提示词', firstTask?.instructions.includes('任务提示词保存回归。'));
const openedTask = await agentRequest(web, 'sessions.open', { id: taskId });
check('任务历史保存了完整目标', openedTask.messages[0]?.item.content?.[0]?.text === goal);
check('进度写进了控制面', /README 多了一行/.test(done1.task.progress), done1.task.progress);
check('步数按模型轮数累加', done1.task.steps === 3, String(done1.task.steps));
check('成本累加到任务上', done1.task.cost > 0, String(done1.task.cost));
check('设备收到了工具调用', calls.length === 1 && calls[0].name === 'shell', JSON.stringify(calls[0]?.arguments));
check('任务工具参数里没有 device（绑死了）', calls[0] && !('device' in calls[0].arguments));

/* ── 2. 助理下一轮能看到任务快照 ── */
queues.router.push(round([say('那个任务已经做完了')]));
const beforeRouter2 = doneCount(web, 'router');
await agentRequest(web, 'messages.send', { id: 'router', text: '进度怎么样' });
await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === 'router' && m.data?.type === 'done'
  && doneCount(web, 'router') > beforeRouter2, 30000, 'router done 2');
const routerPrompt = requests.filter((r) => r.role === 'router').at(-1)?.instructions || '';
check('助理提示词里有任务快照', routerPrompt.includes(taskId) && routerPrompt.includes('[done]'), routerPrompt.slice(0, 200));
check('助理提示词里带进度', /进度：.*README 多了一行/.test(routerPrompt), routerPrompt.slice(-400));
check('助理使用保存的提示词', routerPrompt.includes('助理提示词保存回归。'));

/* ── 3. 任务会话里发话 = 追加指令，任务重新打开再跑一轮 ── */
queues.task.push(round([call('k3', 'read', { path: '/tmp/task/README' })]));
queues.task.push(round([say('看过了，还是原来那行')]));
const beforeTask = doneCount(web, taskId);
const steered = await agentRequest(web, 'messages.send', { id: taskId, text: '再看一眼文件' });
check('给已结束的任务发话会重新打开', steered.task_id === taskId && steered.running === true, JSON.stringify(steered));
await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === taskId && m.data?.type === 'done'
  && doneCount(web, taskId) > beforeTask, 30000, 'task done 2');
await wait(200);
const done2 = await agentRequest(web, 'tasks.get', { id: taskId });
check('追加指令后任务再次 done', done2.task.status === 'done', done2.task.status);
const taskPrompt = requests.filter((r) => r.role === 'task').at(-1)?.body || {};
const sent = JSON.stringify(taskPrompt.input || taskPrompt.messages || []);
check('任务在新一轮里读到了追加的指令', sent.includes('再看一眼文件'));
check('任务提示词里带目标和设备', (requests.filter((r) => r.role === 'task').at(-1)?.instructions || '').includes('补一行 README'));

/* ── 4. 任务举手表决：needs_human 不会被"完成"盖掉，取消后变 cancelled ── */
queues.router.push(round([call('d2', 'dispatch_task', { title: '清理旧日志', goal: '删掉 /tmp/task 里的旧日志', device: DEV })]));
queues.router.push(round([say('派出去了，要你确认删除')]));
queues.task.push(round([call('k4', 'report', { progress: '需要确认：要删 3 个日志文件', needs_human: true })]));
const beforeRouter3 = doneCount(web, 'router');
await agentRequest(web, 'messages.send', { id: 'router', text: '清理日志' });
await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === 'router' && m.data?.type === 'done'
  && doneCount(web, 'router') > beforeRouter3, 30000, 'router done 3');
const dispatched2 = events(web, 'router').filter((e) => e.type === 'function_call_output' && e.item)
  .map((e) => unwrap(e.item.output)).filter((out) => out.task_id).at(-1);
const task2 = dispatched2?.task_id;
await waitTask(web, task2);
const waiting = await agentRequest(web, 'tasks.get', { id: task2 });
check('需要人决定时状态停在 needs_human', waiting.task.status === 'needs_human', waiting.task.status);
check('需要人决定时有进度', /确认/.test(waiting.task.progress), waiting.task.progress);
const cancelled = await agentRequest(web, 'tasks.cancel', { id: task2 });
const afterCancel = await agentRequest(web, 'tasks.get', { id: task2 });
check('取消后状态是 cancelled', cancelled.cancelled === true && afterCancel.task.status === 'cancelled', afterCancel.task.status);

queues.router.push(round([say('那个任务停下了')]));
const beforeRouter4 = doneCount(web, 'router');
await agentRequest(web, 'messages.send', { id: 'router', text: '还有个要确认的任务吗' });
await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === 'router' && m.data?.type === 'done'
  && doneCount(web, 'router') > beforeRouter4, 30000, 'router done 4');

/* ── 5. 预算：步数用超了自动停，状态 failed ── */
queues.router.push(round([call('d3', 'dispatch_task', { title: '预算上限验证', goal: '一直干下去', device: DEV, budget: { steps: 1 } })]));
queues.router.push(round([say('派了，一有结果告诉你')]));
queues.task.push(round([call('k5', 'shell', { command: 'echo 1' })]));
queues.task.push(round([call('k6', 'shell', { command: 'echo 2' })]));
const beforeRouter5 = doneCount(web, 'router');
await agentRequest(web, 'messages.send', { id: 'router', text: '跑个长任务' });
await web.waitFor((m) => m.type === 'agent.event' && m.data?.session_id === 'router' && m.data?.type === 'done'
  && doneCount(web, 'router') > beforeRouter5, 30000, 'router done 5');
const task3 = events(web, 'router').filter((e) => e.type === 'function_call_output' && e.item)
  .map((e) => unwrap(e.item.output)).filter((out) => out.task_id).at(-1)?.task_id;
await waitTask(web, task3);
const over = await agentRequest(web, 'tasks.get', { id: task3 });
check('超出预算自动停', over.task.status === 'failed', over.task.status);
check('失败原因写的是预算', /步数上限/.test(over.task.progress), over.task.progress);

/* ── 6. 助理不能自己动手：派活工具之外没有设备工具 ── */
const routerTools = JSON.stringify(requests.filter((r) => r.role === 'router').at(-1)?.body?.tools || []);
check('助理工具里有 dispatch_task / tasks / steer_task / cancel_task / sql',
  ['dispatch_task', 'tasks', 'steer_task', 'cancel_task', 'sql'].every((name) => routerTools.includes(`"${name}"`)));
check('助理工具里没有 shell / read / write / edit / browser',
  ['shell', 'read', 'write', 'edit', 'browser'].every((name) => !routerTools.includes(`"${name}"`)));
const taskTools = JSON.stringify(requests.filter((r) => r.role === 'task').at(-1)?.body?.tools || []);
check('任务工具有 report 和设备工具', taskTools.includes('"report"') && taskTools.includes('"shell"'));
check('任务工具里没有 dispatch_task / tasks', !taskTools.includes('dispatch_task') && !taskTools.includes('"tasks"'));

/* ── 7. Router 的 SQL 沿用 sql 工具的对象参数（含占位符） ── */
queues.router.push(round([call('sql1', 'sql', {
  sql: 'SELECT id, status FROM tasks WHERE id = ?', params: [taskId],
})]));
queues.router.push(round([say('查到了任务状态')]));
await runTurn(web, 'router', [], 'router', '查一下任务表');
const sqlOutput = events(web, 'router').find((e) => e.type === 'function_call_output' && e.item?.call_id === 'sql1');
const sqlResult = sqlOutput ? unwrap(sqlOutput.item.output) : {};
check('助理 SQL 工具正确执行带参数的查询', sqlResult.success === true
  && sqlResult.rows?.[0]?.id === taskId && sqlResult.rows[0].status === 'done', JSON.stringify(sqlResult));

/* ── 8. 删除任务的会话，控制面那行跟着删 ── */
await agentRequest(web, 'sessions.delete', { id: taskId });
const gone = await agentFail(web, 'tasks.get', { id: taskId });
check('删除会话后任务也消失', /任务不存在/.test(gone), gone);
const finalList = (await agentRequest(web, 'tasks.list')).tasks;
check('任务列表里没有已删除的任务', !finalList.some((t) => t.id === taskId));

/* ── 9. 参数校验 ── */
check('任务状态参数校验', /任务状态无效/.test(await agentFail(web, 'tasks.list', { status: 'weird' })));
check('空目标的指令被拒', /请输入指令/.test(await agentFail(web, 'tasks.steer', { id: task2, text: '   ' })));
check('不存在的任务返回 404 文案', /任务不存在/.test(await agentFail(web, 'tasks.get', { id: 'nope' })));

/* ── 10. 模型拒绝请求时，保留具体错误，清理运行态，并允许原任务重试 ── */
queues.task.length = 0;
queues.task.push({ error: 'provider rejected task input' });
const rejected = await agentRequest(web, 'tasks.dispatch', { title: '失败重试验证', goal: '验证模型失败后仍可继续', device: DEV });
await waitTask(web, rejected.task_id);
const failedTask = (await agentRequest(web, 'tasks.get', { id: rejected.task_id })).task;
check('失败任务保留模型的具体错误', failedTask.status === 'failed'
  && failedTask.progress.includes('API HTTP 400：provider rejected task input'), failedTask.progress);
const failedSession = await agentRequest(web, 'sessions.open', { id: rejected.task_id });
check('失败任务的运行态已清理', failedSession.running === false);
await runTurn(web, rejected.task_id, [round([say('重试成功')])], 'task', '继续');
const retried = (await agentRequest(web, 'tasks.get', { id: rejected.task_id })).task;
check('失败任务可在原会话中重试完成', retried.status === 'done' && retried.progress === '重试成功', retried.status);

await agentRequest(web, 'sessions.delete', { id: task2 });
await agentRequest(web, 'sessions.delete', { id: task3 });
await agentRequest(web, 'sessions.delete', { id: rejected.task_id });
dev.close();
web.close();
model.close();
log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);

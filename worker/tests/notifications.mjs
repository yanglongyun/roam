// 真正的本地 Worker / D1 / DO + 假模型、假设备；可独立运行，会自行建立隔离状态。
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentHttpRequest } from '../shared/agent-http.js';

const port = Number(process.env.PORT || 9530);
const modelPort = port + 100;
const state = mkdtempSync(join(tmpdir(), 'roam-notifications-'));
const assets = join(state, 'assets');
mkdirSync(assets);
writeFileSync(join(assets, 'index.html'), '<!doctype html><title>Notification tests</title>');
const cli = 'node_modules/wrangler/bin/wrangler.js';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log(`✓ ${label}`); };
async function until(fn, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await wait(30); }
  throw new Error(`超时：${label}`);
}
function sql(command) {
  let raw;
  try {
    raw = execFileSync(process.execPath, [cli, 'd1', 'execute', 'roam', '--local', '--persist-to', state,
      '--command', command, '--json'], { encoding: 'utf8', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, timeout: 10000 });
  } catch (error) {
    // 本机 Wrangler 偶尔成功输出后不退出；只接受成功退出码和完整成功 JSON，查询失败仍抛出。
    if (error.code !== 'ETIMEDOUT' || error.status !== 0) throw error;
    const completed = JSON.parse(error.stdout);
    if (!completed.length || !completed.every((entry) => entry.success)) throw error;
    raw = error.stdout;
  }
  return JSON.parse(raw).flatMap((result) => result.results);
}
const say = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const round = (output) => ({ output, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
const taskRounds = [];
const routerRounds = [];
const noticeRequests = [];
const holds = [];
let failNotice = false;
function hold() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  holds.push(release);
  return { promise, release };
}
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const notice = body.instructions.includes('现在是任务状态通知触发的回复');
  const task = body.instructions.includes('你要独立完成这件任务');
  let next;
  if (notice) {
    const payloads = [];
    for (const item of [...body.input].reverse()) {
      const text = item.content?.[0]?.text || '';
      if (item.role !== 'user' || !text.startsWith('[任务状态通知]\n')) break;
      payloads.unshift(JSON.parse(text.slice('[任务状态通知]\n'.length)));
    }
    noticeRequests.push({ body, payloads });
    if (failNotice) {
      failNotice = false;
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'test notification outage' } }));
      return;
    }
    next = round([say('主动汇报：' + payloads.map((p) => `${p.task_id} ${p.status} ${p.progress}`).join('；'))]);
  } else next = (task ? taskRounds : routerRounds).shift();
  if (!next) { res.writeHead(400).end('missing scripted round'); return; }
  if (next.error) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: next.error } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (next.hold) {
    res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '正在处理' })}\n\n`);
    await next.hold.promise;
  }
  res.end(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', ...next } })}\n\n`);
});

let dev;
let logs = '';
const clients = [];
function client(kind = 'web') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?device=${kind}${kind === 'desktop' ? '&device_id=notify-test-device' : ''}`,
    kind === 'desktop' ? { headers: { authorization: 'Bearer e2e-token' } } : {});
  const messages = [];
  ws.addEventListener('message', ({ data }) => messages.push(JSON.parse(data)));
  ws.addEventListener('error', () => {});
  const entry = { ws, messages, send: (type, data, to = 'hub') => ws.send(JSON.stringify({ type, data, to })) };
  clients.push(entry);
  return entry;
}
async function login() {
  const web = client();
  await until(() => web.ws.readyState === WebSocket.OPEN, 'web open');
  web.send('auth.submit', { password: 'e2e-pass' });
  await until(() => web.messages.some((m) => m.type === 'auth.state' && m.data.authenticated), 'login');
  return web;
}
async function request(web, op, args = {}) {
  const { url, method, body } = agentHttpRequest(op, args);
  const token = web.messages.find((m) => m.type === 'auth.state' && m.data.sessionToken)?.data.sessionToken;
  const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, body,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type':'application/json' } : {}) } });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`${op} (HTTP ${response.status}): ${result.error}`);
  return result.data;
}
async function start() {
  dev = spawn(process.execPath, [cli, 'dev', '--port', String(port), '--persist-to', state, '--assets', assets,
    '--var', 'SETTINGS_KEY:dev', '--var', 'DEVICE_TOKEN:e2e-token', '--var', 'ACCESS_PASSWORD:e2e-pass'],
  { detached: true, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  dev.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-30000); });
  dev.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-30000); });
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}`)).ok; } catch { return false; } }, 'Worker ready');
}
async function stop() {
  for (const entry of clients) entry.ws.close();
  if (!dev || dev.exitCode !== null) return;
  const closed = new Promise((resolve) => dev.once('exit', resolve));
  process.kill(-dev.pid, 'SIGTERM');
  await closed;
}
const noticesFor = (id) => noticeRequests.filter((r) => r.payloads.some((p) => p.task_id === id));
async function reported(id) {
  await until(() => noticesFor(id).length > 0, 'automatic report');
  await until(() => sql(`SELECT id FROM task_notifications WHERE task_id = '${id}' AND delivered_at IS NOT NULL`).length > 0, 'notification acknowledged');
}
async function dispatch(web, goal, outputs = [round([say('任务完整结果')])]) {
  taskRounds.push(...outputs);
  return (await request(web, 'tasks.dispatch', { title: '通知验证', goal, device: 'notify-test-device' })).task_id;
}

try {
  execFileSync(process.execPath, [cli, 'd1', 'execute', 'roam', '--local', '--persist-to', state,
    '--file=server/agent/schema.sql', '--json'], { env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: 'pipe', timeout: 30000 });
  await new Promise((resolve) => model.listen(modelPort, '127.0.0.1', resolve));
  await start();
  let web = await login();
  const anonymous = await fetch(`http://127.0.0.1:${port}/api/agent/tasks`);
  check('HTTP 业务接口拒绝未登录访问，且不缓存敏感响应', () => {
    assert.equal(anonymous.status,401);
    assert.equal(anonymous.headers.get('cache-control'),'no-store');
    assert.equal((anonymous.headers.get('content-type') || '').startsWith('application/json'),true);
  });
  const invalid = await fetch(`http://127.0.0.1:${port}/api/agent/config`, {headers:{Authorization:'Bearer wrong-token'}});
  check('错误 HTTP 登录令牌被拒绝', () => assert.equal(invalid.status,401));
  const token = web.messages.find((m) => m.data?.sessionToken)?.data.sessionToken;
  const httpHeaders = { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' };
  const badMethod = await fetch(`http://127.0.0.1:${port}/api/agent/config`,{method:'POST',headers:httpHeaders,body:'{}'});
  const badJson = await fetch(`http://127.0.0.1:${port}/api/agent/tasks`,{method:'POST',headers:httpHeaders,body:'{'});
  check('HTTP 接口校验方法和 JSON，而不是返回 SPA 页面', () => {
    assert.equal(badMethod.status,405);
    assert.match(badMethod.headers.get('allow'),/GET/);
    assert.equal(badJson.status,400);
  });
  await assert.rejects(request(web,'sessions.create'), /HTTP 410/);
  await assert.rejects(request(web,'tasks.get',{id:'missing-task'}), /HTTP 404/);

  const device = client('desktop');
  await until(() => device.ws.readyState === WebSocket.OPEN, 'device open');
  device.send('device.report', { name: '通知测试设备', platform: 'darwin', workdir: '/tmp' }, 'server');
  await request(web, 'config.put', { responsesUrl: `http://127.0.0.1:${modelPort}/v1/responses`, apiKey: 'local-test', model: 'test-notification-model' });
  const publicConfig = await request(web,'config.get');
  const registered = await request(web,'devices.list');
  await request(web,'devices.patch',{id:'notify-test-device',description:'HTTP 更新设备描述'});
  const usage = await request(web,'usage.stats',{tz_offset:480});
  check('配置、设备、用量也走带鉴权 HTTP，密钥不回显', () => {
    assert.equal(publicConfig.key_set,true); assert.equal(publicConfig.apiKey,undefined);
    assert.ok(registered.devices.some((d) => d.id === 'notify-test-device'));
    assert.ok(usage.today && usage.month && usage.all);
  });
  await assert.rejects(request(web,'tasks.dispatch',{title:'设备校验',goal:'不存在设备',device:'ghost-device'}), /HTTP 400.*设备不存在/);
  check('尚未打开助理时也能直接手动创建任务', () => assert.equal(sql("SELECT id FROM sessions WHERE id = 'router'").length, 0));
  await assert.rejects(request(web, 'tasks.dispatch', { goal: '缺少标题', device: 'notify-test-device' }), /HTTP 400.*任务标题不能为空/);
  await assert.rejects(request(web, 'tasks.dispatch', { title: '长'.repeat(61), goal: '长度校验', device: 'notify-test-device' }), /HTTP 400.*任务标题最多/);
  await assert.rejects(request(web, 'tasks.dispatch', { title: '两行\n标题', goal: '单行校验', device: 'notify-test-device' }), /HTTP 400.*单行/);
  check('创建任务必须明确填写简短单行标题', () => assert.equal(sql('SELECT id FROM tasks').length, 0));

  const doneId = await dispatch(web, '独立完成后主动通知');
  await reported(doneId);
  check('任务完成会自动唤醒助理，无需人再发消息', () => assert.equal(noticesFor(doneId)[0].payloads[0].status, 'done'));
  const original = (await request(web, 'tasks.get', { id: doneId })).task;
  await request(web, 'tasks.patch', { id: doneId, title: '结果通知验收' });
  const renamed = (await request(web, 'tasks.get', { id: doneId })).task;
  check('标题与完整目标独立保存，改名不会改变执行目标', () => {
    assert.equal(original.title, '通知验证');
    assert.equal(renamed.title, '结果通知验收');
    assert.equal(renamed.goal, '独立完成后主动通知');
    assert.equal(noticesFor(doneId)[0].payloads[0].title, '通知验证');
    assert.equal(noticesFor(doneId)[0].payloads[0].goal, '独立完成后主动通知');
  });
  const history = await request(web, 'sessions.open', { id: 'router' });
  check('助理会话保存通知和主动回复，通知有明确来源', () => {
    assert.ok(history.messages.some((m) => m.notification_id && m.task_id === doneId));
    assert.equal(history.messages.find((m) => m.notification_id && m.task_id === doneId).task_title, '结果通知验收');
    assert.ok(history.messages.some((m) => m.item.role === 'assistant' && m.item.content[0].text.includes(doneId)));
  });
  await assert.rejects(request(web, 'tasks.patch', { id: doneId, title: '  ' }), /HTTP 400.*不能为空/);
  await assert.rejects(request(web, 'sessions.patch', { id: doneId, title: '错误入口' }), /HTTP 400.*任务中修改/);
  const beforeFollowup = noticesFor(doneId).length;
  taskRounds.push(round([say('用户在任务里的补充要求也已完成')]));
  await request(web, 'messages.send', { id: doneId, text: '继续按我的补充要求执行' });
  await until(() => noticesFor(doneId).length === beforeFollowup + 1, 'task message reported');
  await until(() => sql(`SELECT id FROM task_notifications WHERE task_id = '${doneId}' AND delivered_at IS NOT NULL`).length === 2, 'followup acknowledged');
  check('用户在已结束任务里发消息后继续执行，并再次主动上报助理', () => {
    assert.equal(noticesFor(doneId).at(-1).payloads.at(-1).status, 'done');
    assert.match(noticesFor(doneId).at(-1).payloads.at(-1).result, /补充要求也已完成/);
  });
  const seeded = Array.from({length:130},(_,index) =>
    `('http-history', '${JSON.stringify({type:'message',role:'user',content:[{type:'input_text',text:`history-${index}`} ]})}', ${Date.now()+index})`).join(',');
  sql(`INSERT INTO sessions(id,title,created_at,updated_at) VALUES('http-history','HTTP 分页验证',1,1); INSERT INTO messages(session_id,item,created_at) VALUES ${seeded}`);
  const latest = await request(web,'sessions.open',{id:'http-history'});
  const older = await request(web,'messages.list',{id:'http-history',before:latest.messages[0].id,limit:60});
  const oldest = await request(web,'messages.list',{id:'http-history',before:older.messages[0].id,limit:60});
  check('HTTP 历史分页使用 before 游标，跨三页无遗漏、无重复', () => {
    assert.deepEqual([latest.messages.length,older.messages.length,oldest.messages.length],[60,60,10]);
    assert.equal(latest.has_more,true); assert.equal(older.has_more,true); assert.equal(oldest.has_more,false);
    const combined = [...oldest.messages,...older.messages,...latest.messages];
    assert.equal(new Set(combined.map((m) => m.id)).size,130);
    assert.deepEqual(combined.map((m) => m.item.content[0].text),Array.from({length:130},(_,i) => `history-${i}`));
    assert.ok(latest.event_cursor.epoch);
  });
  await assert.rejects(request(web,'messages.list',{id:'http-history',before:-1}), /HTTP 400/);
  web.ws.close();
  await until(() => web.ws.readyState === WebSocket.CLOSED,'web disconnected for HTTP read');
  const disconnectedPage = await request(web,'messages.list',{id:'http-history',limit:10});
  check('没有任何网页 WS 连接时，HTTP 仍可查询记录', () => assert.equal(disconnectedPage.messages.length,10));
  web = await login();
  await request(web,'sessions.delete',{id:'http-history'});
  const failedId = await dispatch(web, '失败要主动汇报', [{ error: 'device task model rejected' }]);
  await reported(failedId);
  check('任务失败带具体原因通知助理', () => {
    const payload = noticesFor(failedId)[0].payloads[0];
    assert.equal(payload.status, 'failed');
    assert.match(payload.result, /device task model rejected/);
  });
  const humanId = await dispatch(web, '需要人工决定', [round([{ type: 'function_call', call_id: 'human-report', name: 'report',
    arguments: JSON.stringify({ progress: '请选择是否继续', needs_human: true }) }, {
      type: 'function_call', call_id: 'must-not-run', name: 'shell', arguments: JSON.stringify({ command: 'must-not-run' }),
    }])]);
  await reported(humanId);
  check('需要人工决定时也会主动通知', () => assert.equal(noticesFor(humanId)[0].payloads[0].status, 'needs_human'));
  await until(async () => !(await request(web, 'sessions.open', { id: humanId })).running, 'task paused for human');
  check('等待人工决定时立即暂停，不执行后面的工具', () => assert.equal(device.messages.filter((m) => m.type === 'tool.call').length, 0));

  const busy = hold();
  routerRounds.push({ ...round([say('原来的问题处理完成')]), hold: busy });
  await request(web, 'messages.send', { id: 'router', text: '先处理我的问题' });
  const beforeBusy = noticeRequests.length;
  const a = await dispatch(web, '并发结果 A');
  const b = await dispatch(web, '并发结果 B');
  await until(async () => (await request(web, 'tasks.get', { id: b })).task.status === 'done', 'both tasks finished');
  check('助理忙时先排队，不插入本轮上下文或并发回复', () => assert.equal(noticeRequests.length, beforeBusy));
  busy.release();
  await reported(a);
  await reported(b);
  check('多个结果合并到下一轮处理，没有漏报', () => {
    assert.equal(noticeRequests.length - beforeBusy, 1);
    assert.deepEqual(new Set(noticeRequests.at(-1).payloads.map((p) => p.task_id)), new Set([a, b]));
  });

  const offline = hold();
  const offlineId = await dispatch(web, '网页离线时也要汇报', [{ ...round([say('离线完成')]), hold: offline }]);
  web.ws.close();
  offline.release();
  await reported(offlineId);
  web = await login();
  const offlineHistory = await request(web, 'sessions.open', { id: 'router' });
  check('所有网页离线时，后台仍会通知并保存助理回复', () => {
    assert.ok(offlineHistory.messages.some((m) => m.item.role === 'assistant' && m.item.content[0].text.includes(offlineId)));
  });

  failNotice = true;
  const retryId = await dispatch(web, '汇报失败后重启补投');
  await until(() => sql(`SELECT id FROM task_notifications WHERE task_id = '${retryId}' AND attempts = 1`).length === 1, 'first notification failed');
  const beforeRestart = sql(`SELECT message_id FROM task_notifications WHERE task_id = '${retryId}'`)[0].message_id;
  await stop();
  sql(`UPDATE task_notifications SET next_attempt_at = 0 WHERE task_id = '${retryId}'`);
  await start();
  web = await login();
  await reported(retryId);
  const retried = sql(`SELECT message_id, delivered_at FROM task_notifications WHERE task_id = '${retryId}'`)[0];
  check('服务重启后自动补投未确认通知', () => assert.ok(retried.delivered_at));
  check('重试复用同一条通知消息，历史不重复', () => assert.equal(retried.message_id, beforeRestart));
  const stable = noticeRequests.length;
  await request(web, 'router.open');
  await request(web, 'router.open');
  await wait(200);
  check('已确认的通知不会再次触发助理', () => assert.equal(noticeRequests.length, stable));

  const secondDevice = client('desktop');
  await until(() => secondDevice.ws.readyState === WebSocket.OPEN, 'device reconnect');
  secondDevice.send('device.report', { name: '通知测试设备', platform: 'darwin', workdir: '/tmp' }, 'server');
  const steering = hold();
  const steerId = await dispatch(web, '追加指令不应汇报旧轮取消', [{ ...round([say('旧轮')]), hold: steering }]);
  await until(() => web.messages.some((m) => m.data?.session_id === steerId && m.data?.delta), 'task streaming');
  taskRounds.push(round([say('新指令已完成')]));
  await request(web, 'tasks.steer', { id: steerId, text: '按新的要求继续' });
  steering.release();
  await reported(steerId);
  check('追加指令只汇报新结果，不把旧轮中止当作任务取消', () => {
    assert.deepEqual(noticesFor(steerId).flatMap((r) => r.payloads.filter((p) => p.task_id === steerId).map((p) => p.status)), ['done']);
  });

  const interrupted = hold();
  const interruptedId = await dispatch(web, '服务重启中断也要通知', [{ ...round([say('未完成')]), hold: interrupted }]);
  await until(() => web.messages.some((m) => m.data?.session_id === interruptedId && m.data?.delta), 'task before restart');
  await stop();
  interrupted.release();
  await start();
  web = await login();
  await reported(interruptedId);
  check('重启中断的任务会主动向助理报告 interrupted', () => assert.equal(noticesFor(interruptedId)[0].payloads[0].status, 'interrupted'));
  const revoked = web.messages.find((m) => m.data?.sessionToken)?.data.sessionToken;
  for (let i=0;i<10;i++) web.send('auth.submit',{password:'wrong-password'});
  await until(() => web.ws.readyState === WebSocket.CLOSED,'password lockout');
  const afterLockout = await fetch(`http://127.0.0.1:${port}/api/agent/tasks`,{headers:{Authorization:`Bearer ${revoked}`}});
  check('密码锁定后旧令牌也不能继续查询 HTTP 数据', () => assert.equal(afterLockout.status,401));
  check('HTTP 非法请求和提前返回不会产生请求流生命周期异常', () => assert.doesNotMatch(logs,/Can't read from request stream after response has been sent/));
  console.log(`\n${checks} 项 HTTP 与任务主动通知检查全部通过`);
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  for (const release of holds) release();
  await stop();
  model.closeAllConnections();
  await new Promise((resolve) => model.close(resolve));
}

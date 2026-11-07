// 任务的控制面：状态、进度、设备、预算。
// 一个任务就是一个会话（tasks.id = sessions.id），执行过程全留在 messages；
// 这里只存 Router 每轮都要读的那点热点数据，所以列表页和提示词都不用扫消息。
import { fail } from './store.js';
import { all, batch, one, run, statement } from './db.js';
import { message } from './ai.js';
import { outcomeStatements } from './notifications.js';
import { normalizeTaskTitle, TASK_GOAL_MAX } from '../../shared/tasks.js';

// 标题优先 tasks.title（rename_task 写的覆盖值），空则回退到会话标题；
// 完整目标就是创建时的首条用户消息，不额外保存第二份目标。
const TASK_SELECT = `SELECT t.id, t.status, t.progress, t.device_id, t.workdir, t.budget,
  t.steps, t.cost, t.pinned, t.created_at, t.updated_at, t.finished_at,
  COALESCE(t.title, s.title) AS title,
  (SELECT json_extract(m.item, '$.content[0].text') FROM messages m
   WHERE m.session_id = t.id ORDER BY m.id LIMIT 1) AS goal
  FROM tasks t LEFT JOIN sessions s ON s.id = t.id`;

// 助理（Router）是固定 id 的单会话，只派活、不执行。
export const ROUTER_ID = 'router';
export const ROUTER_TITLE = '助理';

// 还在跑的（含等人）；interrupted 是上次进程被回收留下的痕迹。
export const OPEN_STATES = ['queued', 'running', 'needs_human'];
// 助理每轮任务清单里要排在最近任务之前的「需要关注」状态。
export const ATTENTION_STATES = [...OPEN_STATES, 'failed', 'interrupted'];
export const STATES = [...OPEN_STATES, 'done', 'failed', 'cancelled', 'interrupted'];

export async function ensureRouter(env) {
  const now = Date.now();
  await run(
    env,
    'INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    [ROUTER_ID, ROUTER_TITLE, now, now],
  );
  return { id: ROUTER_ID, title: ROUTER_TITLE };
}

function shape(row) {
  let budget = null;
  if (row.budget) {
    try {
      budget = JSON.parse(row.budget);
    } catch {
      budget = null;
    }
  }
  return { ...row, pinned: Boolean(row.pinned), budget, running: row.status === 'running', open: OPEN_STATES.includes(row.status) };
}

// 预算只认不小于 1 的分钟 / 步数和不小于 0 的金额，坏值当没填。
export function normalizeBudget(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const budget = {};
  for (const [key, min] of [['steps', 1], ['minutes', 1], ['cost', 0]]) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value >= min && (key === 'cost' || value >= 1)) budget[key] = value;
  }
  return Object.keys(budget).length ? budget : null;
}

export async function createTask(env, { title, goal, deviceId = '', workdir = '', budget = null }) {
  try { title = normalizeTaskTitle(title); } catch (error) { fail(400, error.message); }
  if (typeof goal !== 'string') fail(400, '任务目标必须是文字');
  const text = goal.trim();
  if (!text) fail(400, '任务目标不能为空');
  if (text.length > TASK_GOAL_MAX) fail(400, `任务目标太长（最多 ${TASK_GOAL_MAX} 字）`);
  const id = crypto.randomUUID();
  const now = Date.now();
  await batch(env, [
    statement(env, 'INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      id,
      title,
      now,
      now,
    ]),
    statement(
      env,
      'INSERT INTO tasks (id, status, progress, device_id, workdir, budget, steps, cost, created_at, updated_at) ' +
        "VALUES (?, 'queued', '', ?, ?, ?, 0, 0, ?, ?)",
      [id, deviceId || '', workdir || '', budget ? JSON.stringify(budget) : '', now, now],
    ),
    // 与任务一起落库：第一轮必须有用户输入，目标也要进入可压缩、可追加的会话历史。
    statement(env, 'INSERT INTO messages (session_id, item, created_at) VALUES (?, ?, ?)', [
      id,
      JSON.stringify(message(text)),
      now,
    ]),
  ]);
  return getTask(env, id);
}

export async function getTask(env, id) {
  if (typeof id !== 'string' || !id) return null;
  const row = await one(
    env,
    `${TASK_SELECT} WHERE t.id = ?`,
    [id],
  );
  return row ? shape(row) : null;
}

export async function requireTask(env, id) {
  const task = await getTask(env, id);
  if (!task) fail(404, '任务不存在');
  return task;
}

export async function listTasks(env, { status = '', limit = 50, pinned } = {}) {
  const args = [];
  const where = [];
  if (status) {
    if (!STATES.includes(status)) fail(400, '任务状态无效');
    where.push('t.status = ?');
    args.push(status);
  }
  if (pinned !== undefined) {
    where.push('t.pinned = ?');
    args.push(pinned ? 1 : 0);
  }
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  args.push(size);
  const rows = await all(
    env,
    `${TASK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.updated_at DESC LIMIT ?`,
    args,
  );
  return rows.map(shape);
}

// 常驻置顶任务：全部取出，不设上限，保证不会被挤出任务清单。
export async function listPinnedTasks(env) {
  const rows = await all(env, `${TASK_SELECT} WHERE t.pinned = 1 ORDER BY t.updated_at DESC`);
  return rows.map(shape);
}

// 常驻置顶：只写 tasks.pinned，不动 sessions.pin（那是侧栏会话置顶的顺序）。
export async function pinTask(env, id, pinned) {
  await requireTask(env, id);
  if (typeof pinned !== 'boolean') fail(400, 'pinned 必须是布尔值');
  await run(env, 'UPDATE tasks SET pinned = ?, updated_at = ? WHERE id = ?', [pinned ? 1 : 0, Date.now(), id]);
  return getTask(env, id);
}

export async function renameTask(env, id, value) {
  await requireTask(env, id);
  let title;
  try { title = normalizeTaskTitle(value); } catch (error) { fail(400, error.message); }
  // tasks.title 是任务标题的正式来源；会话标题同步改，保证其他按会话显示的地方一致。
  const now = Date.now();
  await batch(env, [
    statement(env, 'UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?', [title, now, id]),
    statement(env, 'UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', [title, now, id]),
  ]);
  return getTask(env, id);
}

// 默认只删任务控制面那行，消息和会话都留着（历史还能用 sql 查）；
// withMessages=true 时才把消息、压缩摘要和通知一起删，会话行仍保留作历史锚点。
export async function deleteTask(env, id, { withMessages = false } = {}) {
  await requireTask(env, id);
  if (!withMessages) {
    await batch(env, [
      statement(env, 'DELETE FROM task_notifications WHERE task_id = ?', [id]),
      statement(env, 'DELETE FROM tasks WHERE id = ?', [id]),
    ]);
    return { id, deleted: true, withMessages: false };
  }
  await batch(env, [
    statement(env, 'DELETE FROM task_notifications WHERE task_id = ?', [id]),
    statement(env, 'DELETE FROM messages WHERE session_id = ?', [id]),
    statement(env, 'DELETE FROM compactions WHERE session_id = ?', [id]),
    statement(env, 'DELETE FROM tasks WHERE id = ?', [id]),
  ]);
  return { id, deleted: true, withMessages: true };
}

async function update(env, id, fields, notification = null) {
  const keys = Object.keys(fields);
  if (!keys.length) return getTask(env, id);
  const sets = keys.map((key) => `${key} = ?`).join(', ');
  const now = Date.now();
  const changed = statement(env, `UPDATE tasks SET ${sets}, updated_at = ? WHERE id = ?`, [
    ...keys.map((key) => fields[key]),
    now,
    id,
  ]);
  await batch(env, [changed, ...(notification ? outcomeStatements(env, id, notification, now) : [])]);
  return getTask(env, id);
}

export async function patchTask(env, id, fields, notification = null) {
  const allowed = ['status', 'progress', 'device_id', 'workdir', 'steps', 'cost', 'finished_at'];
  const clean = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) clean[key] = fields[key];
  }
  if (clean.status && !STATES.includes(clean.status)) fail(400, '任务状态无效');
  if (clean.progress !== undefined) clean.progress = String(clean.progress).slice(0, 300);
  return update(env, id, clean, notification);
}

// 步数和成本是累加的：用 SQL 自增，不做读-改-写，两个循环同时更新也不会丢。
export async function addUsage(env, id, { steps = 0, cost = 0 } = {}) {
  await run(env, 'UPDATE tasks SET steps = steps + ?, cost = cost + ?, updated_at = ? WHERE id = ?', [
    steps,
    cost,
    Date.now(),
    id,
  ]);
}

// 进程被回收后，内存里的循环全没了：启动时把还标着在跑的任务改成 interrupted，
// 免得 UI 永远显示"正在执行"。
export async function markStale(env) {
  const rows = await all(env, "SELECT id FROM tasks WHERE status IN ('queued', 'running')");
  if (!rows.length) return [];
  const now = Date.now();
  await batch(
    env,
    rows.flatMap((row) => [
      statement(
        env,
        "UPDATE tasks SET status = 'interrupted', progress = ?, updated_at = ?, finished_at = ? WHERE id = ?",
        ['运行被中断（服务重启）', now, now, row.id],
      ),
      ...outcomeStatements(env, row.id, { id: crypto.randomUUID(), result: '运行被中断（服务重启）' }, now),
    ]),
  );
  return rows.map((row) => row.id);
}

export async function removeTaskRow(env, id) {
  await run(env, 'DELETE FROM tasks WHERE id = ?', [id]);
}

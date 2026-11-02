// 持久化层：配置（settings）、设备登记（devices）、会话与消息。
// 全部 async —— D1 没有同步接口，调用方都要 await。
import { defaults, validateConfig } from './config.js';
import { all, batch, first, one, run, statement } from './db.js';
import { decryptValue, encryptValue } from './crypto.js';

export function fail(status, text) {
  const error = new Error(text);
  error.status = status;
  throw error;
}

export function pick(args, fields) {
  const data = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (Object.keys(data).some((key) => !fields.includes(key))) {
    fail(400, '请求包含未知字段');
  }
  return data;
}

/* ───────────────────────── 配置 ───────────────────────── */

function settingsSecret(env) {
  return env.SETTINGS_KEY || 'roam-default-settings-key';
}

export async function loadConfig(env) {
  const rows = await all(env, 'SELECT key, value FROM settings');
  const config = defaults();
  const stored = {};
  for (const row of rows) {
    if (row.key === 'apiKey') {
      stored.apiKey = await decryptValue(settingsSecret(env), row.value);
      continue;
    }
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      /* 坏行跳过，用默认值兜底。 */
    }
  }
  Object.assign(config, stored);
  validateConfig(config);
  return config;
}

export async function saveConfig(env, config) {
  validateConfig(config);
  const now = Date.now();
  const statements = [];
  for (const [key, value] of Object.entries(config)) {
    const stored =
      key === 'apiKey'
        ? await encryptValue(settingsSecret(env), value)
        : JSON.stringify(value);
    statements.push(
      statement(
        env,
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [key, stored, now],
      ),
    );
  }
  await batch(env, statements);
}

// 设置页展示用：不回显密钥，只给前后几位。
export async function publicConfig(env, config) {
  let keyHint = '';
  if (config.apiKey) {
    keyHint =
      config.apiKey.length <= 10
        ? '***'
        : config.apiKey.slice(0, 6) + '...' + config.apiKey.slice(-4);
  }
  const device = await activeDevice(env);
  return {
    responsesUrl: config.responsesUrl,
    key_set: Boolean(config.apiKey),
    key_hint: keyHint,
    model: config.model,
    context_window: config.context_window,
    system: config.system,
    compact_at: config.compact_at,
    keep: config.keep,
    compact_system: config.compact_system,
    compact_prefix: config.compact_prefix,
    workdir: config.workdir || device?.workdir || '',
    run_timeout: config.run_timeout,
    timeout: config.timeout,
    max_output: config.max_output,
    device: device
      ? { id: device.id, name: device.name, host: device.host, online: true, browser: Boolean(device.browser) }
      : null,
  };
}

/* ───────────────────────── 设备 ───────────────────────── */

// 设备每次连上来都刷新一次环境快照，云端拼提示词、判在线都用这张表。
export async function upsertDevice(env, device) {
  const now = Date.now();
  await run(
    env,
    `INSERT INTO devices (id, name, platform, arch, host, username, workdir, browser, last_seen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       platform = excluded.platform,
       arch = excluded.arch,
       host = excluded.host,
       username = excluded.username,
       workdir = excluded.workdir,
       browser = excluded.browser,
       last_seen = excluded.last_seen`,
    [
      device.id || 'desktop',
      device.name || '',
      device.platform || '',
      device.arch || '',
      device.host || '',
      device.username || '',
      device.workdir || '',
      device.browser ? 1 : 0,
      now,
      now,
    ],
  );
}

export async function touchDevice(env, id = 'desktop') {
  await run(env, 'UPDATE devices SET last_seen = ? WHERE id = ?', [Date.now(), id]);
}

export async function activeDevice(env, id = 'desktop') {
  return one(env, 'SELECT * FROM devices WHERE id = ?', [id]);
}

/* ───────────────────────── 会话 ───────────────────────── */

const PAGE = 50;

const PREVIEW_SQL = `sessions.*, (
  SELECT item FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1
) AS first`;

function previewOf(first) {
  if (!first) return '';
  let content = [];
  try {
    content = JSON.parse(first).content || [];
  } catch {
    return '';
  }
  let preview = content.map((part) => part.text || '').join('');
  preview = preview.replace(/\s+/g, ' ').slice(0, 60);
  if (!preview && content.some((part) => part.type === 'input_image')) {
    preview = '[图片]';
  }
  return preview;
}

export async function listSessions(env, args, running = new Set()) {
  const { before = null, before_id: beforeId = '' } = pick(args, ['before', 'before_id']);
  if (before !== null && !Number.isSafeInteger(before)) {
    fail(400, 'before 无效');
  }
  let pinned = [];
  let rows;
  if (before === null) {
    pinned = await all(
      env,
      `SELECT ${PREVIEW_SQL} FROM sessions WHERE pin IS NOT NULL ORDER BY pin`,
    );
    rows = await all(
      env,
      `SELECT ${PREVIEW_SQL} FROM sessions WHERE pin IS NULL
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [PAGE + 1],
    );
  } else {
    rows = await all(
      env,
      `SELECT ${PREVIEW_SQL} FROM sessions
       WHERE pin IS NULL AND (updated_at < ? OR (updated_at = ? AND id < ?))
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [before, before, String(beforeId), PAGE + 1],
    );
  }
  const sessions = [...pinned, ...rows.slice(0, PAGE)].map(({ first, ...session }) => ({
    ...session,
    preview: previewOf(first),
    pinned: session.pin !== null,
    running: running.has(session.id),
  }));
  return { sessions, has_more: rows.length > PAGE };
}

export async function createSession(env, deviceId = 'desktop') {
  const id = crypto.randomUUID();
  const now = Date.now();
  await run(
    env,
    'INSERT INTO sessions (id, title, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, '', deviceId, now, now],
  );
  return {
    id,
    title: '',
    device_id: deviceId,
    created_at: now,
    updated_at: now,
    pin: null,
    preview: '',
    pinned: false,
    running: false,
  };
}

export async function requireSession(env, id) {
  const row = typeof id === 'string' ? await one(env, 'SELECT * FROM sessions WHERE id = ?', [id]) : null;
  if (!row) fail(404, '会话不存在');
  return row;
}

export async function openSession(env, args, runState = null) {
  const { id } = pick(args, ['id']);
  await requireSession(env, id);
  const rows = await all(
    env,
    'SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 61',
    [id],
  );
  const messages = rows
    .slice(0, 60)
    .reverse()
    .map((row) => ({
      ...row,
      item: JSON.parse(row.item),
      usage: row.usage ? JSON.parse(row.usage) : null,
    }));
  const compactions = await all(
    env,
    'SELECT * FROM compactions WHERE session_id = ? ORDER BY id',
    [id],
  );
  return {
    messages,
    has_more: rows.length > 60,
    compactions,
    running: Boolean(runState),
    streaming: runState ? { text: runState.text, reasoning: runState.reasoning } : null,
  };
}

export async function patchSession(env, args, running = new Set()) {
  const data = pick(args, ['id', 'title', 'pinned']);
  const id = data.id;
  if (data.title === undefined && data.pinned === undefined) {
    fail(400, '缺少要修改的字段');
  }
  if (data.title !== undefined && (typeof data.title !== 'string' || [...data.title.trim()].length > 120)) {
    fail(400, '标题最多 120 字符');
  }
  if (data.pinned !== undefined && typeof data.pinned !== 'boolean') {
    fail(400, 'pinned 必须是布尔值');
  }
  const session = await requireSession(env, id);
  const statements = [];
  if (data.title !== undefined) {
    statements.push(statement(env, 'UPDATE sessions SET title = ? WHERE id = ?', [data.title.trim(), id]));
  }
  if (data.pinned === true && session.pin === null) {
    const row = await one(env, 'SELECT MIN(pin) AS pin FROM sessions');
    const pin = row?.pin === null || row?.pin === undefined ? 0 : row.pin - 1;
    statements.push(statement(env, 'UPDATE sessions SET pin = ? WHERE id = ?', [pin, id]));
  }
  if (data.pinned === false) {
    statements.push(statement(env, 'UPDATE sessions SET pin = NULL WHERE id = ?', [id]));
  }
  if (statements.length) await batch(env, statements);
  const updated = await one(env, 'SELECT * FROM sessions WHERE id = ?', [id]);
  return { ...updated, pinned: updated.pin !== null, running: running.has(id) };
}

export async function reorderPins(env, args) {
  const { ids } = pick(args, ['ids']);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    fail(400, 'ids 必须是字符串数组');
  }
  const current = (await all(env, 'SELECT id FROM sessions WHERE pin IS NOT NULL')).map((row) => row.id);
  if (
    ids.length !== current.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !current.includes(id))
  ) {
    fail(409, '置顶对话已变化，请刷新后再排序');
  }
  await batch(
    env,
    ids.map((id, index) => statement(env, 'UPDATE sessions SET pin = ? WHERE id = ?', [index, id])),
  );
  return { ids };
}

export async function removeSession(env, args, running = new Set()) {
  const { id } = pick(args, ['id']);
  await requireSession(env, id);
  if (running.has(id)) fail(409, '会话正在回复，请先停止');
  // 会话用到的图片：上传时记了 session_id，工具产出的图也走同一个字段。
  const images = await all(env, 'SELECT id FROM images WHERE session_id = ?', [id]);
  await batch(env, [
    statement(env, 'DELETE FROM messages WHERE session_id = ?', [id]),
    statement(env, 'DELETE FROM compactions WHERE session_id = ?', [id]),
    statement(env, 'DELETE FROM sessions WHERE id = ?', [id]),
  ]);
  return { deleted: id, images: images.map((row) => row.id) };
}

/* ───────────────────────── 消息 ───────────────────────── */

export async function listMessages(env, args) {
  const { id, limit: limitArg = 60, before: beforeArg = 0 } = pick(args, ['id', 'limit', 'before']);
  await requireSession(env, id);
  if (!Number.isSafeInteger(limitArg) || limitArg < 0) fail(400, 'limit 无效');
  if (!Number.isSafeInteger(beforeArg) || beforeArg < 0) fail(400, 'before 无效');
  const limit = Math.min(500, Math.max(1, limitArg));
  const rows = await all(
    env,
    `SELECT * FROM messages WHERE session_id = ? AND (? = 0 OR id < ?)
     ORDER BY id DESC LIMIT ?`,
    [id, beforeArg, beforeArg, limit + 1],
  );
  const messages = rows
    .slice(0, limit)
    .reverse()
    .map((row) => ({
      ...row,
      item: JSON.parse(row.item),
      usage: row.usage ? JSON.parse(row.usage) : null,
    }));
  return { messages, has_more: rows.length > limit };
}

// 存一条完整 item，同时把会话的 updated_at 推到现在。
export async function saveMessage(env, sessionId, item) {
  const createdAt = Date.now();
  const [inserted] = await batch(env, [
    statement(env, 'INSERT INTO messages (session_id, item, created_at) VALUES (?, ?, ?)', [
      sessionId,
      JSON.stringify(item),
      createdAt,
    ]),
    statement(env, 'UPDATE sessions SET updated_at = ? WHERE id = ?', [createdAt, sessionId]),
  ]);
  return { id: Number(inserted.meta.last_row_id), created_at: createdAt };
}

export async function setMessageUsage(env, id, usage) {
  await run(env, 'UPDATE messages SET usage = ? WHERE id = ?', [JSON.stringify(usage), id]);
}

// 最近一次模型响应的用量，决定开始前是否压缩；没有就是 null。
export async function lastUsage(env, sessionId) {
  const row = await one(
    env,
    `SELECT usage FROM messages WHERE session_id = ? AND (
       json_extract(item, '$.role') = 'assistant'
       OR json_extract(item, '$.type') IN ('function_call', 'reasoning')
     ) ORDER BY id DESC LIMIT 1`,
    [sessionId],
  );
  return row?.usage ? JSON.parse(row.usage) : null;
}

// 上下文 = 最新摘要 + 摘要覆盖位置之后的全部消息。
export async function contextMessages(env, sessionId) {
  const latest = await one(
    env,
    'SELECT * FROM compactions WHERE session_id = ? ORDER BY id DESC LIMIT 1',
    [sessionId],
  );
  const stored = await all(
    env,
    'SELECT id, item FROM messages WHERE session_id = ? AND id > ? ORDER BY id',
    [sessionId, latest?.message_id || 0],
  );
  return { latest, stored };
}

export async function addCompaction(env, sessionId, messageId, summary) {
  const row = await first(
    env,
    'INSERT INTO compactions (session_id, message_id, summary, created_at) VALUES (?, ?, ?, ?) RETURNING *',
    [sessionId, messageId, summary, Date.now()],
  );
  return row;
}

// 对话标题：用户起的标题，没有就用第一句话。浏览器插件用它命名标签组。
export async function sessionTitle(env, sessionId) {
  const session = await one(
    env,
    `SELECT title, (SELECT item FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1) AS first
     FROM sessions WHERE id = ?`,
    [sessionId],
  );
  if (!session) return '';
  if (session.title) return session.title;
  if (!session.first) return '';
  try {
    return JSON.parse(session.first)
      .content.map((part) => part.text || '')
      .join('')
      .replace(/\s+/g, ' ')
      .slice(0, 40);
  } catch {
    return '';
  }
}

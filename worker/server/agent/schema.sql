-- 云端数据（Cloudflare D1）。
-- 应用方式：npx wrangler d1 execute roam --remote --file=server/agent/schema.sql
-- 全部 IF NOT EXISTS，可以反复执行。升级已有库时另外跑 migrate.sql。

-- 会话。pin 为空表示未置顶；有值时是置顶组内的顺序，数字小的在前。
-- system_prompt 是这一轮助理提示词的会话级覆盖，存 JSON 编码字符串（同 settings.value）；空则回退到 settings。
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  pin INTEGER,
  system_prompt TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

-- 每个模型 item 一行；usage 只附在每次模型响应的最后一项。
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  item TEXT NOT NULL,
  usage TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

-- 上下文摘要，覆盖到 message_id 这条消息（含）。
CREATE TABLE IF NOT EXISTS compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id INTEGER,
  summary TEXT,
  usage TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_compactions_session ON compactions(session_id, id);

-- 设备登记。id 由电脑端首次启动时生成并保存在 ~/.roam/device.json。
-- name / description 以云端为准（网页设置里可改）；电脑端上报的值只在云端为空时填入。
-- last_seen 由设备每次连上时刷新。
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  platform TEXT,
  arch TEXT,
  host TEXT,
  username TEXT,
  workdir TEXT,
  browser INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER,
  created_at INTEGER
);

-- 云端配置（键值）：模型地址、模型名、提示词、压缩阈值等。
-- API Key 也放这里，写入前用 Worker secret 派生的密钥加密。
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER
);

-- 图片元信息，文件本体在 R2（键 images/<id>.<ext>）。
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  mime TEXT,
  size INTEGER,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_images_session ON images(session_id, created_at);

-- 给 sql 工具用的只读视图。模型不用自己写 json_extract。
CREATE VIEW IF NOT EXISTS v_sessions AS
SELECT
  s.id,
  s.title,
  s.pin,
  s.created_at,
  s.updated_at,
  (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
FROM sessions s;

-- kind: message / reasoning / function_call / function_call_output
-- text: 正文（message/reasoning）
-- tool_name + payload: 工具名与调用参数或结果
CREATE VIEW IF NOT EXISTS v_messages AS
SELECT
  m.id,
  m.session_id,
  json_extract(m.item, '$.type') AS kind,
  json_extract(m.item, '$.role') AS role,
  json_extract(m.item, '$.name') AS tool_name,
  json_extract(m.item, '$.content[0].text') AS text,
  COALESCE(json_extract(m.item, '$.arguments'), json_extract(m.item, '$.output')) AS payload,
  json_extract(m.item, '$.call_id') AS call_id,
  m.created_at
FROM messages m;

CREATE VIEW IF NOT EXISTS v_compactions AS
SELECT id, session_id, message_id, summary, usage, created_at FROM compactions;

DROP VIEW IF EXISTS v_devices;
CREATE VIEW IF NOT EXISTS v_devices AS
SELECT id, name, description, platform, host, username, workdir, browser, last_seen FROM devices;

-- 任务的控制面。id 就是那个任务自己的会话 id（tasks.id = sessions.id），
-- 一个任务 = 一个会话 = 一个 agent 循环；执行过程仍然全在 messages 里。
-- 状态 / 进度 / 设备 / 预算这些是 Router 每轮都要读的热点，所以单独成表，不去扫消息。
-- status: queued / running / needs_human / done / failed / cancelled / interrupted
-- budget: {"steps": 40, "minutes": 30, "cost": 0.8}，都是上限，可以缺项。
-- title 是任务标题的覆盖值（rename_task 写），空则回退到 sessions.title；
-- pinned 是任务级常驻置顶（1 = 每轮都进助理的任务清单），和 sessions.pin（侧栏会话置顶排序）是两回事。
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  progress TEXT NOT NULL DEFAULT '',
  device_id TEXT,
  workdir TEXT,
  budget TEXT,
  steps INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, updated_at);

-- 任务状态和通知原子提交；助理成功处理后才确认投递。message_id 用于重启去重。
CREATE TABLE IF NOT EXISTS task_notifications (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  message_id INTEGER UNIQUE,
  delivered_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_notifications_pending ON task_notifications(delivered_at, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_task_notifications_task ON task_notifications(task_id);

-- 给 sql 工具和 Router 的快照用：标题优先 tasks.title，空则回退到会话标题；目标来自创建时的首条消息。
DROP VIEW IF EXISTS v_tasks;
CREATE VIEW IF NOT EXISTS v_tasks AS
SELECT
  t.id,
  COALESCE(t.title, s.title) AS title,
  t.pinned,
  (SELECT json_extract(m.item, '$.content[0].text') FROM messages m
   WHERE m.session_id = t.id ORDER BY m.id LIMIT 1) AS goal,
  t.status,
  t.progress,
  t.device_id,
  t.workdir,
  t.steps,
  t.cost,
  t.created_at,
  t.updated_at,
  t.finished_at,
  (SELECT COUNT(*) FROM messages m WHERE m.session_id = t.id) AS message_count
FROM tasks t
LEFT JOIN sessions s ON s.id = t.id;

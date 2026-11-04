-- 云端数据（Cloudflare D1）。
-- 应用方式：npx wrangler d1 execute roam --remote --file=server/agent/schema.sql
-- 全部 IF NOT EXISTS，可以反复执行。升级已有库时另外跑 migrate.sql。

-- 会话。pin 为空表示未置顶；有值时是置顶组内的顺序，数字小的在前。
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  pin INTEGER,
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
SELECT id, session_id, message_id, summary, created_at FROM compactions;

DROP VIEW IF EXISTS v_devices;
CREATE VIEW IF NOT EXISTS v_devices AS
SELECT id, name, description, platform, host, username, workdir, browser, last_seen FROM devices;

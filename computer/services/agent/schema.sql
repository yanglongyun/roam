-- 本地数据库结构。服务启动时由 db.js 执行；只建当前结构，不写迁移。

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
  session_id TEXT,
  item TEXT,
  usage TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

-- 上下文摘要，覆盖到 message_id 这条消息（含）；之后的消息原样发给模型。
CREATE TABLE IF NOT EXISTS compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  message_id INTEGER,
  summary TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_compactions_session ON compactions(session_id, id);

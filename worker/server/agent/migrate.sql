-- 升级已有库，按你之前部署的版本二选一，执行完都再跑一次 schema.sql 重建视图。
--
-- 从单设备 / session 版升级：整个文件执行一次
--   npx wrangler d1 execute roam --remote --file=server/agent/migrate.sql
--
-- 已经是多设备 hub 版（devices 表有 description 列）：只去掉会话的默认设备
--   npx wrangler d1 execute roam --remote --command "DROP VIEW IF EXISTS v_sessions; ALTER TABLE sessions DROP COLUMN device_id"
--
-- 已经部署过、要加任务（多出 tasks 表和 v_tasks 视图）：直接跑一遍 schema.sql 就行
--   npx wrangler d1 execute roam --remote --file=server/agent/schema.sql

-- 已有任务版升级主动汇报：部署前再跑 schema.sql，增加 task_notifications 表和索引。
-- 不需要修改旧 tasks / messages 列，也不会自动补发所有历史已结束任务。

-- 已经部署过、要加用量计费（compactions 没有 usage 列）：
--   npx wrangler d1 execute roam --remote --command "ALTER TABLE compactions ADD COLUMN usage TEXT; DROP VIEW IF EXISTS v_compactions"
--   再跑一次 schema.sql 重建 v_compactions（老数据的 usage 没有 model 字段，按当前配置的模型折算金额）

-- 已经部署过、要加会话级提示词覆盖（sessions 没有 system_prompt 列）：
--   npx wrangler d1 execute roam --remote --command "ALTER TABLE sessions ADD COLUMN system_prompt TEXT"
--   新环境建表已带这一列（见 schema.sql），老库不用重建视图。

-- 已经部署过任务、要加任务标题覆盖和常驻置顶（tasks 没有 title / pinned 列）：
--   npx wrangler d1 execute roam --remote --command "ALTER TABLE tasks ADD COLUMN title TEXT; ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"
--   再跑一次 schema.sql 重建 v_tasks（标题优先 tasks.title，并带 pinned）。
--   旧任务 title 为空，照旧回退到 sessions.title；pinned 默认 0。
ALTER TABLE tasks ADD COLUMN title TEXT;
ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE devices ADD COLUMN description TEXT;
DROP TABLE IF EXISTS active;

-- 会话不再绑默认设备：在哪台设备上执行由每次工具调用的 device 参数决定。
DROP VIEW IF EXISTS v_sessions;
ALTER TABLE sessions DROP COLUMN device_id;

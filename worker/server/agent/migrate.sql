-- 升级已有库，按你之前部署的版本二选一，执行完都再跑一次 schema.sql 重建视图。
--
-- 从单设备 / session 版升级：整个文件执行一次
--   npx wrangler d1 execute roam --remote --file=server/agent/migrate.sql
--
-- 已经是多设备 hub 版（devices 表有 description 列）：只去掉会话的默认设备
--   npx wrangler d1 execute roam --remote --command "DROP VIEW IF EXISTS v_sessions; ALTER TABLE sessions DROP COLUMN device_id"

ALTER TABLE devices ADD COLUMN description TEXT;
DROP TABLE IF EXISTS active;

-- 会话不再绑默认设备：在哪台设备上执行由每次工具调用的 device 参数决定。
DROP VIEW IF EXISTS v_sessions;
ALTER TABLE sessions DROP COLUMN device_id;

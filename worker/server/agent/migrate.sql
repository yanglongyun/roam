-- 从单设备 / session 版升级到多设备 hub 版。只需执行一次：
--   npx wrangler d1 execute roam --remote --file=server/agent/migrate.sql
-- 注意：devices 表如果已经有 description 列，先把下面这行 ALTER 删掉再执行。
ALTER TABLE devices ADD COLUMN description TEXT;
DROP TABLE IF EXISTS active;

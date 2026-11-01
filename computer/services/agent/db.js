import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// 表结构统一写在 schema.sql。
const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

// 服务启动时打开数据库并初始化表。
export default function openDB(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    db.exec(schema);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

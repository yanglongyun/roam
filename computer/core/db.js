// 本机单一 SQLite 库：~/.roam/roam.db。
// roam 一贯「数据留在本机」——对话、消息、压缩、设置全落地于此，不进仓库、不过 Worker。
// DatabaseSync 同步调用，函数内读-改-写之间无 await 间隙，并发请求天然串行，写入走事务。
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import fs from 'fs';

const ROOT = path.join(os.homedir(), '.roam');
const DB_PATH = path.join(ROOT, 'roam.db');

let db = null;

function getDb() {
    if (db) return db;
    fs.mkdirSync(ROOT, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chats (
            id         TEXT PRIMARY KEY,
            title      TEXT NOT NULL DEFAULT '新对话',
            state      TEXT NOT NULL DEFAULT 'idle',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            message    TEXT NOT NULL,
            meta       TEXT NOT NULL DEFAULT '{}',
            usage      TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
        CREATE TABLE IF NOT EXISTS compactions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id          TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            start_message_id INTEGER NOT NULL,
            end_message_id   INTEGER NOT NULL,
            summary          TEXT NOT NULL,
            tokens           INTEGER NOT NULL DEFAULT 0,
            created_at       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_compactions_chat ON compactions(chat_id, id);
    `);
    return db;
}

export { ROOT, DB_PATH, getDb };
export default { ROOT, DB_PATH, getDb };

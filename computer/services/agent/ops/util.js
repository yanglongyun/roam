// 操作共用的小函数：失败带状态码（沿用 HTTP 语义），参数只认列出的字段。
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

export function requireSession(db, id) {
    if (typeof id !== 'string' || !db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)) {
        fail(404, '会话不存在');
    }
}

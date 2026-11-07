import { matchAgentHttp } from '../../shared/agent-http.js';
import { callOp } from './api.js';
import { fail } from './store.js';

export const jsonResponse = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'cache-control': 'no-store', ...headers },
});

// 在跨 Worker / DO 转发前读取有上限的请求体。DO 拒绝非法 JSON 或方法时，
// 不能让上游还在转发的原始请求流继续依赖已结束的请求生命周期。
export async function bufferAgentRequest(request) {
    if (!request.body) return request;
    const maximum = 30 * 1024 * 1024;
    if (Number(request.headers.get('content-length') || 0) > maximum) fail(413, '请求内容过大');
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximum) { await reader.cancel(); fail(413, '请求内容过大'); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new Request(request, { body });
}

// 鉴权由 hub 统一完成，读取可拿到同一 hub 的在线运行快照。
export async function agentHttp(request, ctx) {
    try {
        const url = new URL(request.url);
        const matches = matchAgentHttp(url.pathname);
        if (!matches.length) return jsonResponse({ ok: false, error: '接口不存在' }, 404);
        const route = matches.find(({ method }) => method === request.method);
        if (!route) {
            await request.body?.cancel();
            return jsonResponse({ ok: false, error: '请求方法不支持' }, 405, {
                allow: [...new Set(matches.map(({ method }) => method))].join(', '),
            });
        }
        const args = Object.create(null);
        for (const [key, value] of url.searchParams) {
            if (Object.hasOwn(args, key)) fail(400, '查询参数不能重复');
            args[key] = ['limit', 'before', 'tz_offset'].includes(key) && /^-?\d+$/.test(value) ? Number(value) : value;
        }
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
            const size = Number(request.headers.get('content-length') || 0);
            if (size > 30 * 1024 * 1024) fail(413, '请求内容过大');
            let body;
            try { body = await request.json(); } catch { fail(400, '请求内容必须是 JSON'); }
            if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请求内容必须是对象');
            if (Object.keys(body).some((key) => Object.hasOwn(args, key))) fail(400, '请求参数不能重复');
            Object.assign(args, body);
        }
        if (Object.keys(route.params).some((key) => Object.hasOwn(args, key))) fail(400, '路径参数不能重复');
        Object.assign(args, route.params);
        const data = await callOp(ctx, route.op, args);
        return jsonResponse({ ok: true, data });
    } catch (error) {
        const status = error.status || (error instanceof URIError ? 400 : 500);
        if (status >= 500) console.error('HTTP 业务请求失败：', error.message);
        return jsonResponse({ ok: false, error: status >= 500 ? '服务暂时不可用，请稍后重试' : error.message }, status);
    }
}

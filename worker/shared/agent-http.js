// 网页业务请求走 HTTP；这份路由表同时供前端和 Worker 使用。
const PREFIX = '/api/agent';
export const agentRoutes = [
    ['GET', '/status', 'status.get'],
    ['GET', '/devices', 'devices.list'],
    ['PATCH', '/devices/:id', 'devices.patch'],
    ['DELETE', '/devices/:id', 'devices.remove'],
    ['GET', '/sessions', 'sessions.list'],
    ['POST', '/sessions', 'sessions.create'],
    ['GET', '/sessions/:id', 'sessions.open'],
    ['PATCH', '/sessions/:id', 'sessions.patch'],
    ['DELETE', '/sessions/:id', 'sessions.delete'],
    ['PUT', '/session-pins', 'sessions.pins'],
    ['GET', '/sessions/:id/messages', 'messages.list'],
    ['POST', '/sessions/:id/messages', 'messages.send'],
    ['POST', '/sessions/:id/stop', 'run.stop'],
    ['GET', '/usage', 'usage.stats'],
    ['GET', '/config', 'config.get'],
    ['PUT', '/config', 'config.put'],
    ['POST', '/images', 'images.upload'],
    ['GET', '/images', 'images.get'],
    ['GET', '/tasks', 'tasks.list'],
    ['GET', '/tasks/:id', 'tasks.get'],
    ['PATCH', '/tasks/:id', 'tasks.patch'],
    ['POST', '/tasks', 'tasks.dispatch'],
    ['POST', '/tasks/:id/messages', 'tasks.steer'],
    ['POST', '/tasks/:id/cancel', 'tasks.cancel'],
    ['POST', '/assistant/open', 'router.open'],
];

const aliases = { 'sessions.remove': 'sessions.delete', 'messages.stop': 'run.stop' };
export function agentHttpRequest(op, args = {}) {
    const route = agentRoutes.find(([, , name]) => name === (aliases[op] || op));
    if (!route) throw new Error(`没有这个操作：${op}`);
    const [method, path] = route;
    const rest = { ...args };
    const pathname = path.replace(/:([a-z_]+)/g, (_, key) => {
        if (typeof rest[key] !== 'string' || !rest[key]) throw new Error(`缺少 ${key}`);
        const value = rest[key];
        delete rest[key];
        return encodeURIComponent(value);
    });
    const query = new URLSearchParams();
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
    if (!hasBody) {
        for (const [key, value] of Object.entries(rest)) {
            if (value !== undefined && value !== null) query.set(key, String(value));
        }
    }
    return {
        url: PREFIX + pathname + (query.size ? `?${query}` : ''), method,
        ...(hasBody ? { body: JSON.stringify(rest) } : {}),
    };
}

export function matchAgentHttp(pathname) {
    if (!pathname.startsWith(PREFIX + '/')) return [];
    const actual = pathname.slice(PREFIX.length).split('/');
    return agentRoutes.flatMap(([method, path, op]) => {
        const parts = path.split('/');
        if (parts.length !== actual.length) return [];
        const params = {};
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].startsWith(':')) {
                if (!actual[i]) return [];
                params[parts[i].slice(1)] = decodeURIComponent(actual[i]);
            } else if (parts[i] !== actual[i]) return [];
        }
        return [{ method, op, params }];
    });
}

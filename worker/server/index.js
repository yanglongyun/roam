import { DurableObject } from "cloudflare:workers";
import { callOp } from "./agent/api.js";
import { DeviceBridge } from "./agent/rpc.js";
import { activeSession, loadConfig, setActiveSession, upsertDevice } from "./agent/store.js";
import { readImage } from "./agent/images.js";

function socketId() {
    return crypto.randomUUID();
}

// 电脑端连上来要带 DEVICE_TOKEN：电脑端能免密码、能放行网页，
// 云端又存着对话和 API Key，不校验的话谁都能冒充电脑端把数据读走。
async function deviceTokenValid(request, env) {
    const expected = env.DEVICE_TOKEN || '';
    const header = request.headers.get('authorization') || '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!expected || !given) return false;
    const encoder = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(expected)),
        crypto.subtle.digest('SHA-256', encoder.encode(given)),
    ]);
    return crypto.subtle.timingSafeEqual(a, b);
}

export class TerminalSessionManager extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.requiresPassword = true;
        this.authTokens = new Map();  // token -> expiresAt
        this.authFingerprint = null;  // 电脑端密码的指纹，变了就作废所有免密令牌
        this.sessionName = '';        // 这个对象对应的 session（idFromName 用的名字）
        // agent 运行态：配置缓存、正在回复的会话、等设备回话的工具调用。
        this.configCache = null;
        this.runs = new Map();        // sessionId -> { controller, done, text, reasoning, runImages }
        this.bridge = new DeviceBridge();
        this.interrupted = [];        // 上次被平台中断的会话，等前端连上再补 done
        this.ctx.blockConcurrencyWhile(async () => {
            const v = await this.ctx.storage.get('requiresPassword');
            if (typeof v === 'boolean') this.requiresPassword = v;

            const fingerprint = await this.ctx.storage.get('authFingerprint');
            if (typeof fingerprint === 'string') this.authFingerprint = fingerprint;

            const name = await this.ctx.storage.get('sessionName');
            if (typeof name === 'string') this.sessionName = name;

            const tokens = await this.ctx.storage.get('authTokens');
            if (tokens && typeof tokens === 'object') {
                const now = Date.now();
                for (const [tok, exp] of Object.entries(tokens)) {
                    if (typeof exp === 'number' && exp > now) {
                        this.authTokens.set(tok, exp);
                    }
                }
            }

            // 回复中途对象被回收的话，done 永远发不出去，前端会一直显示“正在回复”。
            // 这里清掉残留标记，等前端连上后补一条中断提示。
            const stale = await this.ctx.storage.list({ prefix: 'run:' });
            if (stale.size) {
                this.interrupted = [...stale.keys()].map((key) => key.slice(4));
                await this.ctx.storage.delete([...stale.keys()]);
            }
        });
    }

    async persistAuthTokens() {
        const obj = {};
        for (const [tok, exp] of this.authTokens.entries()) obj[tok] = exp;
        try { await this.ctx.storage.put('authTokens', obj); } catch {}
    }

    issueAuthToken() {
        const token = crypto.randomUUID().replace(/-/g, '')
            + crypto.randomUUID().replace(/-/g, '');
        const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;  // 30 天
        this.authTokens.set(token, expiresAt);
        this.persistAuthTokens();
        return token;
    }

    isTokenValid(token) {
        if (!token) return false;
        const exp = this.authTokens.get(token);
        if (!exp) return false;
        if (exp <= Date.now()) {
            this.authTokens.delete(token);
            this.persistAuthTokens();
            return false;
        }
        return true;
    }

    clearAllAuthTokens() {
        this.authTokens.clear();
        this.persistAuthTokens();
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== '/ws') {
            return new Response('Not Found', { status: 404 });
        }

        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected Upgrade: websocket', { status: 426 });
        }

        const device = url.searchParams.get('device');
        if (device !== 'desktop' && device !== 'web') {
            return new Response('Missing or invalid device param', { status: 400 });
        }

        const session = url.searchParams.get('session') || '';
        if (session && session !== this.sessionName) {
            this.sessionName = session;
            await this.ctx.storage.put('sessionName', session);
        }
        // 电脑端接到哪个 session，哪个 session 就是当前 session，旧 session 从此碰不到云端数据。
        if (device === 'desktop' && this.sessionName) {
            await setActiveSession(this.env, this.sessionName)
                .catch((error) => console.error('记录当前 session 失败：', error.message));
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        const id = socketId();

        // 免登录：web 客户端带有效 authToken 则直接放行
        const tokenParam = url.searchParams.get('authToken') || '';
        const preAuthed = device === 'web' && this.isTokenValid(tokenParam);
        const authenticated = device === 'desktop' || !this.requiresPassword || preAuthed;

        this.ctx.acceptWebSocket(server, [device]);
        server.serializeAttachment({ device, id, authenticated });

        try {
            server.send(JSON.stringify({
                type: 'connection.ready',
                to: device,
                data: {
                    clientId: id,
                    authenticated,
                    requiresPassword: this.requiresPassword,
                },
            }));
        } catch {}

        this.broadcastDeviceStatus();
        this.broadcastAuthState(server);
        if (device === 'web' && authenticated) this.flushInterrupted();

        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, message) {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch {
            return;
        }
        if (!msg?.type) return;

        const att = ws.deserializeAttachment() || {};

        if (msg.type === 'connection.ping') {
            ws.send(JSON.stringify({
                type: 'connection.pong',
                to: att.device,
                data: {},
            }));
            return;
        }

        if (msg.type === 'tool.result' && att.device === 'desktop') {
            this.bridge.settle(msg.data);
            return;
        }

        if (msg.type === 'device.report' && att.device === 'desktop') {
            const { id, name, platform, arch, host, username, workdir, browser } = msg.data || {};
            if (id) {
                upsertDevice(this.env, { id, name, platform, arch, host, username, workdir, browser })
                    .catch((error) => console.error('登记设备失败：', error.message));
            }
            return;
        }

        if (msg.type === 'agent.request') {
            this.handleAgentRequest(ws, msg, att);
            return;
        }

        if (att.device === 'desktop' && (
            msg.type === 'auth.mode'
            || msg.type === 'auth.grant'
            || msg.type === 'auth.reject'
            || msg.type === 'auth.close'
        )) {
            this.handleAuthControl(msg);
            return;
        }

        if (att.device === 'web' && !att.authenticated
            && msg.type !== 'auth.submit'
            && msg.type !== 'auth.request_challenge'
        ) {
            this.broadcastAuthState(ws, '请先输入访问密码');
            return;
        }

        msg.meta = {
            ...(msg.meta || {}),
            clientId: att.id,
            device: att.device,
        };
        this.route(msg);
    }

    async webSocketClose(ws) {
        const att = ws.deserializeAttachment() || {};
        if (att.device === 'desktop' && !this.ctx.getWebSockets('desktop').length) {
            this.bridge.drain();
        }
        this.broadcastDeviceStatus();
    }

    async webSocketError() {
        this.broadcastDeviceStatus();
    }

    handleAuthControl(msg) {
        if (msg.type === 'auth.mode') {
            this.requiresPassword = Boolean(msg.data?.requiresPassword);
            this.ctx.storage.put('requiresPassword', this.requiresPassword).catch(() => {});
            // 密码换了（或第一次知道指纹）：之前发出的免密令牌全部作废，已登录的网页重新输密码。
            const fingerprint = String(msg.data?.fingerprint || '');
            const revoked = fingerprint !== this.authFingerprint;
            if (revoked) {
                this.authFingerprint = fingerprint;
                this.ctx.storage.put('authFingerprint', fingerprint).catch(() => {});
                this.clearAllAuthTokens();
            }
            for (const ws of this.ctx.getWebSockets('web')) {
                const att = ws.deserializeAttachment() || {};
                if (!this.requiresPassword) {
                    ws.serializeAttachment({ ...att, authenticated: true });
                } else if (revoked || !att.authenticated) {
                    ws.serializeAttachment({ ...att, authenticated: false });
                }
                this.broadcastAuthState(ws);
            }
            return;
        }

        const clientId = msg.data?.clientId;
        if (!clientId) return;
        const target = this.findWebSocket(clientId);
        if (!target) return;
        const att = target.deserializeAttachment() || {};

        if (msg.type === 'auth.grant') {
            target.serializeAttachment({ ...att, authenticated: true });

            // 单设备独占：踢掉其它已认证的 web
            for (const other of this.ctx.getWebSockets('web')) {
                if (other === target) continue;
                const oa = other.deserializeAttachment() || {};
                if (!oa.authenticated) continue;
                try {
                    other.serializeAttachment({ ...oa, authenticated: false });
                    other.send(JSON.stringify({
                        type: 'auth.state',
                        to: 'web',
                        data: {
                            authenticated: false,
                            requiresPassword: this.requiresPassword,
                            error: '已在另一台设备登录',
                            kicked: true,
                        },
                    }));
                } catch {}
                try { other.close(4001, 'superseded'); } catch {}
            }

            // 颁发免登录 token，30 天有效
            const sessionToken = this.issueAuthToken();
            try {
                target.send(JSON.stringify({
                    type: 'auth.state',
                    to: 'web',
                    data: {
                        authenticated: true,
                        requiresPassword: this.requiresPassword,
                        error: '',
                        sessionToken,
                    },
                }));
            } catch {}
            return;
        }

        if (msg.type === 'auth.reject') {
            target.serializeAttachment({ ...att, authenticated: false });
            this.broadcastAuthState(target, msg.data?.error || '密码错误');
            return;
        }

        if (msg.type === 'auth.close') {
            // 被锁：清掉所有免登录 token，强制全员重新密码
            this.clearAllAuthTokens();
            try {
                target.send(JSON.stringify({
                    type: 'auth.state',
                    to: 'web',
                    data: {
                        authenticated: false,
                        requiresPassword: this.requiresPassword,
                        error: msg.data?.error || '尝试过多，连接已关闭',
                        closed: true,
                    },
                }));
            } catch {}
            try { target.close(4003, 'too many auth attempts'); } catch {}
        }
    }

    /* ───────────── agent：云端接管，前端协议保持不变 ───────────── */

    agentContext() {
        return {
            env: this.env,
            runs: this.runs,
            bridge: this.bridge,
            config: async () => {
                if (!this.configCache) this.configCache = await loadConfig(this.env);
                return this.configCache;
            },
            invalidateConfig: () => { this.configCache = null; },
            deviceOnline: () => this.ctx.getWebSockets('desktop').length > 0,
            sendToDevice: (message) => this.sendToDevice(message),
            publish: (sessionId, event) => this.publishEvent(sessionId, event),
            waitUntil: (promise) => this.ctx.waitUntil(promise),
            runningIds: () => new Set(this.runs.keys()),
            markRunning: (id) => {
                this.ctx.storage.put(`run:${id}`, Date.now()).catch(() => {});
                this.keepAlive();
            },
            markIdle: (id) => { this.ctx.storage.delete(`run:${id}`).catch(() => {}); },
        };
    }

    async handleAgentRequest(ws, msg, att) {
        const data = msg.data || {};
        const reqId = data.reqId;
        const reply = (payload) => {
            try {
                ws.send(JSON.stringify({ type: 'agent.result', to: 'web', data: { reqId, ...payload } }));
            } catch {}
        };
        if (att.device === 'web' && !att.authenticated) {
            this.broadcastAuthState(ws, '请先输入访问密码');
            reply({ ok: false, error: '请先输入访问密码' });
            return;
        }
        if (att.device === 'web' && (!this.sessionName || this.sessionName !== await activeSession(this.env))) {
            reply({ ok: false, error: '这个链接已失效：电脑端已换到新的会话，请打开电脑端控制台打印的新地址' });
            return;
        }
        try {
            const result = await callOp(this.agentContext(), data.op, data.args || {});
            reply({ ok: true, data: result });
        } catch (error) {
            console.error(`agent ${data.op} 失败：`, error.message);
            reply({ ok: false, error: error.message || '操作失败' });
        }
    }

    publishEvent(sessionId, event) {
        const payload = JSON.stringify({
            type: 'agent.event',
            to: 'web',
            data: { session_id: sessionId, ...event },
        });
        for (const ws of this.ctx.getWebSockets('web')) {
            const att = ws.deserializeAttachment() || {};
            if (!att.authenticated) continue;
            try { ws.send(payload); } catch {}
        }
    }

    sendToDevice(message) {
        const targets = this.ctx.getWebSockets('desktop');
        if (!targets.length) return false;
        try {
            targets[0].send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    }

    // 有回复在跑时定时给自己发 alarm：DO 长时间没有事件会被回收，alarm 相当于心跳。
    keepAlive() {
        this.ctx.storage.getAlarm()
            .then((at) => { if (!at) return this.ctx.storage.setAlarm(Date.now() + 20 * 1000); })
            .catch(() => {});
    }

    async alarm() {
        if (this.runs.size) {
            await this.ctx.storage.setAlarm(Date.now() + 20 * 1000);
        }
    }

    flushInterrupted() {
        if (!this.interrupted.length) return;
        for (const sessionId of this.interrupted) {
            this.publishEvent(sessionId, { type: 'done', status: 'incomplete', stopReason: 'interrupted' });
        }
        this.interrupted = [];
    }

    findWebSocket(clientId) {
        for (const ws of this.ctx.getWebSockets('web')) {
            const att = ws.deserializeAttachment() || {};
            if (att.id === clientId) return ws;
        }
        return null;
    }

    route(msg) {
        const target = msg.to;
        let targets = [];

        if (target === 'all') {
            targets = this.ctx.getWebSockets();
        } else if (target === 'desktop' || target === 'web') {
            targets = this.ctx.getWebSockets(target);
            if (target === 'web') {
                targets = targets.filter((ws) => {
                    const att = ws.deserializeAttachment() || {};
                    return Boolean(att.authenticated);
                });
            }
        } else if (typeof target === 'string' && target.startsWith('web:')) {
            const ws = this.findWebSocket(target.slice(4));
            if (ws) targets = [ws];
        }

        if (!targets.length) return;
        const payload = JSON.stringify(msg);
        for (const ws of targets) {
            try {
                ws.send(payload);
            } catch {}
        }
    }

    broadcastAuthState(ws, error = '') {
        const att = ws.deserializeAttachment() || {};
        if (att.device !== 'web') return;
        try {
            ws.send(JSON.stringify({
                type: 'auth.state',
                to: 'web',
                data: {
                    authenticated: Boolean(att.authenticated),
                    requiresPassword: this.requiresPassword,
                    error,
                },
            }));
        } catch {}
    }

    broadcastDeviceStatus() {
        const payload = JSON.stringify({
            type: 'connection.devices',
            to: 'all',
            data: {
                devices: {
                    desktop: this.ctx.getWebSockets('desktop').length > 0 ? 'connected' : 'disconnected',
                    web: this.ctx.getWebSockets('web').length > 0 ? 'connected' : 'disconnected',
                },
            },
        });
        for (const ws of this.ctx.getWebSockets()) {
            try {
                ws.send(payload);
            } catch {}
        }
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/ws') {
            const sessionId = url.searchParams.get('session');
            if (!sessionId || sessionId === 'default') {
                return new Response('Missing session', { status: 400 });
            }
            if (url.searchParams.get('device') === 'desktop' && !(await deviceTokenValid(request, env))) {
                return new Response('Invalid device token', { status: 401 });
            }
            const id = env.TERMINAL_SESSION_MANAGER.idFromName(sessionId);
            const stub = env.TERMINAL_SESSION_MANAGER.get(id);
            return stub.fetch(request);
        }

        // 图片短地址：前端主要走 images.get，这里给普通 HTTP 访问（复制链接、直接打开）留一条路。
        if (url.pathname.startsWith('/api/images/')) {
            const name = url.pathname.slice('/api/images/'.length);
            try {
                const image = await readImage(env, name);
                return new Response(image.bytes, {
                    headers: {
                        'content-type': image.type,
                        'cache-control': 'private, max-age=31536000, immutable',
                    },
                });
            } catch (error) {
                return new Response(error.message, { status: error.status || 404 });
            }
        }

        return env.ASSETS.fetch(request);
    },
};

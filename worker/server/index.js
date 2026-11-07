import { DurableObject } from "cloudflare:workers";
import { callOp, flushTaskNotifications } from "./agent/api.js";
import { DeviceBridge } from "./agent/rpc.js";
import { listDevices, loadConfig, upsertDevice } from "./agent/store.js";
import { markStale } from "./agent/tasks.js";
import { nextAttempt } from "./agent/notifications.js";
import { readImage } from "./agent/images.js";
import { agentHttp, bufferAgentRequest, jsonResponse } from "./agent/http.js";

// 整个部署只有一个 hub：所有电脑端和所有网页都连它。
const HUB = 'hub';
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_AUTH_FAILS = 10;
const LOCKOUT_MS = 30 * 60 * 1000;
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;

function socketId() {
    return crypto.randomUUID();
}

async function sameSecret(expected, given) {
    if (!expected || !given) return false;
    const encoder = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(expected)),
        crypto.subtle.digest('SHA-256', encoder.encode(given)),
    ]);
    return crypto.subtle.timingSafeEqual(a, b);
}

// 访问密码的指纹：只用来判断密码换没换，存的不是密码本身。
async function passwordFingerprint(password) {
    if (!password) return '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`roam-access-password:${password}`));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// 电脑端连上来要带 DEVICE_TOKEN：电脑端能执行命令、读文件，
// 云端又存着对话和 API Key，不校验的话谁都能冒充电脑端。
function deviceTokenValid(request, env) {
    const header = request.headers.get('authorization') || '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    return sameSecret(env.DEVICE_TOKEN || '', given);
}

export class TerminalSessionManager extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.authTokens = new Map();  // token -> expiresAt
        this.authFails = 0;
        this.lockoutUntil = 0;
        // agent 运行态：配置缓存、正在回复的会话、等设备回话的工具调用。
        this.configCache = null;
        this.runs = new Map();        // sessionId -> { controller, done, text, reasoning, runImages }
        this.notifications = { running: false };
        this.eventEpoch = crypto.randomUUID();
        this.eventSequence = 0;
        this.bridge = new DeviceBridge();
        this.interrupted = [];        // 上次被平台中断的会话，等前端连上再补 done
        this.ctx.blockConcurrencyWhile(async () => {
            const tokens = await this.ctx.storage.get('authTokens');
            if (tokens && typeof tokens === 'object') {
                const now = Date.now();
                for (const [tok, exp] of Object.entries(tokens)) {
                    if (typeof exp === 'number' && exp > now) {
                        this.authTokens.set(tok, exp);
                    }
                }
            }
            // 访问密码换了就作废之前发出的免密令牌。改 secret 会重新部署、对象跟着重启，
            // 所以启动时比一次就够；第一次上线这段逻辑时也会清一次，大家重新登录一次。
            const fingerprint = await passwordFingerprint(this.env.ACCESS_PASSWORD);
            if (fingerprint !== await this.ctx.storage.get('passwordFingerprint')) {
                this.authTokens.clear();
                await this.ctx.storage.put({ authTokens: {}, passwordFingerprint: fingerprint });
            }

            const fails = await this.ctx.storage.get('authFails');
            if (typeof fails === 'number') this.authFails = fails;
            const lockout = await this.ctx.storage.get('lockoutUntil');
            if (typeof lockout === 'number') this.lockoutUntil = lockout;

            // 回复中途对象被回收的话，done 永远发不出去，前端会一直显示“正在回复”。
            // 这里清掉残留标记，等前端连上后补一条中断提示。
            const stale = await this.ctx.storage.list({ prefix: 'run:' });
            if (stale.size) {
                this.interrupted = [...stale.keys()].map((key) => key.slice(4));
                await this.ctx.storage.delete([...stale.keys()]);
            }
            // 内存里的任务循环跟着没了：把还标着在跑的任务改成 interrupted，
            // 免得任务列表永远停在"正在执行"。
            await markStale(this.env);
            const notificationAt = await nextAttempt(this.env);
            if (notificationAt !== null) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, notificationAt));
        });
    }

    /* ───────────── 免密令牌 ───────────── */

    async persistAuthTokens() {
        const obj = {};
        for (const [tok, exp] of this.authTokens.entries()) obj[tok] = exp;
        try { await this.ctx.storage.put('authTokens', obj); } catch {}
    }

    issueAuthToken() {
        const token = crypto.randomUUID().replace(/-/g, '')
            + crypto.randomUUID().replace(/-/g, '');
        this.authTokens.set(token, Date.now() + TOKEN_TTL);
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

    /* ───────────── 密码校验与锁定 ───────────── */

    isLocked() {
        if (this.lockoutUntil && Date.now() >= this.lockoutUntil) {
            this.lockoutUntil = 0;
            this.authFails = 0;
            this.persistAuthState();
        }
        return this.lockoutUntil > 0;
    }

    persistAuthState() {
        this.ctx.storage.put('authFails', this.authFails).catch(() => {});
        this.ctx.storage.put('lockoutUntil', this.lockoutUntil).catch(() => {});
    }

    lockoutMinutes() {
        return Math.max(1, Math.ceil((this.lockoutUntil - Date.now()) / 60000));
    }

    async handleAuthSubmit(ws, att, data) {
        if (!this.env.ACCESS_PASSWORD) {
            this.sendAuthState(ws, { error: '服务端还没有设置访问密码：请管理员先执行 wrangler secret put ACCESS_PASSWORD', closed: true });
            return;
        }
        if (this.isLocked()) {
            this.sendAuthState(ws, { error: `密码错误次数过多，${this.lockoutMinutes()} 分钟后再试`, closed: true });
            try { ws.close(4003, 'too many auth attempts'); } catch {}
            return;
        }
        const ok = await sameSecret(this.env.ACCESS_PASSWORD, String(data?.password ?? ''));
        if (!ok) {
            this.authFails += 1;
            if (this.authFails >= MAX_AUTH_FAILS) {
                this.lockoutUntil = Date.now() + LOCKOUT_MS;
                // 被锁：之前发出的免密令牌一并作废，全员重新输密码。
                this.clearAllAuthTokens();
                this.persistAuthState();
                this.sendAuthState(ws, { error: `密码错误次数过多，${this.lockoutMinutes()} 分钟后再试`, closed: true });
                try { ws.close(4003, 'too many auth attempts'); } catch {}
                return;
            }
            this.persistAuthState();
            this.sendAuthState(ws, { error: `密码错误，剩余 ${MAX_AUTH_FAILS - this.authFails} 次` });
            return;
        }
        this.authFails = 0;
        this.lockoutUntil = 0;
        this.persistAuthState();
        ws.serializeAttachment({ ...att, authenticated: true });
        this.sendAuthState(ws, { sessionToken: this.issueAuthToken() });
        this.onWebAuthenticated(ws, att);
    }

    sendAuthState(ws, extra = {}) {
        const att = ws.deserializeAttachment() || {};
        try {
            ws.send(JSON.stringify({
                type: 'auth.state',
                to: 'web',
                data: { authenticated: Boolean(att.authenticated), error: '', ...extra },
            }));
        } catch {}
    }

    // 网页登录成功：把设备列表给它，补发中断提示，并让各台电脑把终端快照发给这个网页。
    onWebAuthenticated(ws, att) {
        this.sendDevices(ws);
        this.flushInterrupted();
        for (const target of this.ctx.getWebSockets('desktop')) {
            try {
                target.send(JSON.stringify({ type: 'web.joined', to: 'desktop', data: { clientId: att.id } }));
            } catch {}
        }
    }

    /* ───────────── 连接 ───────────── */

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/agent/')) {
            const header = request.headers.get('authorization') || '';
            const token = header.startsWith('Bearer ') ? header.slice(7) : '';
            if (!this.env.ACCESS_PASSWORD || this.isLocked() || !this.isTokenValid(token)) {
                return jsonResponse({ ok: false, error: '登录已过期，请重新输入访问密码' }, 401);
            }
            return agentHttp(request, this.agentContext());
        }
        if (url.pathname !== '/ws') {
            return new Response('Not Found', { status: 404 });
        }
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected Upgrade: websocket', { status: 426 });
        }

        const kind = url.searchParams.get('device');
        if (kind !== 'desktop' && kind !== 'web') {
            return new Response('Missing or invalid device param', { status: 400 });
        }
        const deviceId = kind === 'desktop' ? (url.searchParams.get('device_id') || '') : '';
        if (kind === 'desktop' && !DEVICE_ID.test(deviceId)) {
            return new Response('Missing or invalid device_id', { status: 400 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        const id = socketId();

        if (kind === 'desktop') {
            // 同一台设备重连：旧连接还挂着就先关掉，避免一台设备两条线。
            for (const old of this.ctx.getWebSockets(`desktop:${deviceId}`)) {
                try { old.close(4002, 'replaced'); } catch {}
            }
            this.ctx.acceptWebSocket(server, ['desktop', `desktop:${deviceId}`]);
            server.serializeAttachment({ device: 'desktop', id, deviceId, authenticated: true });
            try {
                server.send(JSON.stringify({ type: 'connection.ready', to: 'desktop', data: { clientId: id, deviceId } }));
            } catch {}
            return new Response(null, { status: 101, webSocket: client });
        }

        // 网页：带有效免密令牌直接放行，否则等 auth.submit。
        const tokenParam = url.searchParams.get('authToken') || '';
        const authenticated = Boolean(this.env.ACCESS_PASSWORD) && this.isTokenValid(tokenParam);
        this.ctx.acceptWebSocket(server, ['web']);
        const att = { device: 'web', id, deviceId: '', authenticated };
        server.serializeAttachment(att);
        try {
            server.send(JSON.stringify({
                type: 'connection.ready',
                to: 'web',
                data: { clientId: id, authenticated, passwordSet: Boolean(this.env.ACCESS_PASSWORD) },
            }));
        } catch {}
        if (!this.env.ACCESS_PASSWORD) {
            this.sendAuthState(server, { error: '服务端还没有设置访问密码：请管理员先执行 wrangler secret put ACCESS_PASSWORD', closed: true });
        } else if (authenticated) {
            this.sendAuthState(server);
            this.onWebAuthenticated(server, att);
        } else {
            this.sendAuthState(server);
        }
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
            ws.send(JSON.stringify({ type: 'connection.pong', to: att.device, data: {} }));
            return;
        }

        if (att.device === 'desktop') {
            if (msg.type === 'tool.result') {
                this.bridge.settle(msg.data);
                return;
            }
            if (msg.type === 'device.report') {
                const { name, platform, arch, host, username, workdir, browser, description } = msg.data || {};
                await upsertDevice(this.env, {
                    id: att.deviceId, name, platform, arch, host, username, workdir, browser, description,
                }).catch((error) => console.error('登记设备失败：', error.message));
                this.broadcastDevices();
                return;
            }
            // 其余都是发给网页的业务消息：带上设备 id，网页按设备过滤。
            msg.meta = { ...(msg.meta || {}), clientId: att.id, device: 'desktop', deviceId: att.deviceId };
            this.route(msg);
            return;
        }

        // 网页
        if (msg.type === 'auth.submit') {
            await this.handleAuthSubmit(ws, att, msg.data);
            return;
        }
        if (!att.authenticated) {
            this.sendAuthState(ws, { error: '请先输入访问密码' });
            return;
        }
        if (msg.type === 'agent.request') {
            this.handleAgentRequest(ws, msg, att);
            return;
        }
        if (msg.type === 'devices.list') {
            this.sendDevices(ws);
            return;
        }
        msg.meta = { ...(msg.meta || {}), clientId: att.id, device: 'web' };
        this.route(msg);
    }

    async webSocketClose(ws) {
        const att = ws.deserializeAttachment() || {};
        if (att.device === 'web') {
            const message = JSON.stringify({ type: 'web.left', to: 'desktop', data: { clientId: att.id } });
            for (const desktop of this.ctx.getWebSockets('desktop')) {
                try { desktop.send(message); } catch {}
            }
        }
        if (att.device === 'desktop' && att.deviceId
            && !this.ctx.getWebSockets(`desktop:${att.deviceId}`).some((other) => other !== ws)) {
            this.bridge.drain(att.deviceId);
        }
        if (att.device === 'desktop') this.broadcastDevices();
    }

    async webSocketError(ws) {
        const att = ws.deserializeAttachment() || {};
        if (att.device === 'desktop') this.broadcastDevices();
    }

    /* ───────────── 设备 ───────────── */

    onlineDeviceIds() {
        const ids = new Set();
        for (const ws of this.ctx.getWebSockets('desktop')) {
            const att = ws.deserializeAttachment() || {};
            if (att.deviceId) ids.add(att.deviceId);
        }
        return ids;
    }

    // 已登记设备 + 在线状态。还没来得及 report 的在线设备也列出来，免得网页看不到。
    async devicesSnapshot() {
        const online = this.onlineDeviceIds();
        let rows = [];
        try {
            rows = await listDevices(this.env);
        } catch (error) {
            console.error('读取设备列表失败：', error.message);
        }
        const devices = rows.map((row) => ({ ...row, browser: Boolean(row.browser), online: online.has(row.id) }));
        for (const id of online) {
            if (!devices.some((device) => device.id === id)) {
                devices.push({ id, name: '', description: '', platform: '', arch: '', host: '', username: '', workdir: '', browser: false, last_seen: null, online: true });
            }
        }
        return devices;
    }

    async sendDevices(ws) {
        const devices = await this.devicesSnapshot();
        try {
            ws.send(JSON.stringify({ type: 'connection.devices', to: 'web', data: { devices } }));
        } catch {}
    }

    async broadcastDevices() {
        const devices = await this.devicesSnapshot();
        const payload = JSON.stringify({ type: 'connection.devices', to: 'web', data: { devices } });
        for (const ws of this.ctx.getWebSockets('web')) {
            const att = ws.deserializeAttachment() || {};
            if (!att.authenticated) continue;
            try { ws.send(payload); } catch {}
        }
    }

    /* ───────────── agent：云端接管，前端协议保持不变 ───────────── */

    agentContext() {
        return {
            env: this.env,
            runs: this.runs,
            eventCursor: () => ({ epoch: this.eventEpoch, sequence: this.eventSequence }),
            notifications: this.notifications,
            scheduleNotifications: (at) => this.scheduleNotificationAlarm(at),
            bridge: this.bridge,
            config: async () => {
                if (!this.configCache) this.configCache = await loadConfig(this.env);
                return this.configCache;
            },
            invalidateConfig: () => { this.configCache = null; },
            onlineDevices: () => this.onlineDeviceIds(),
            devices: () => this.devicesSnapshot(),
            broadcastDevices: () => this.broadcastDevices(),
            sendToDevice: (deviceId, message) => this.sendToDevice(deviceId, message),
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
        try {
            const result = await callOp(this.agentContext(), data.op, data.args || {});
            reply({ ok: true, data: result });
        } catch (error) {
            console.error(`agent ${data.op} 失败：`, error.message);
            reply({ ok: false, error: error.message || '操作失败' });
        }
    }

    publishEvent(sessionId, event) {
        const eventCursor = { epoch: this.eventEpoch, sequence: ++this.eventSequence };
        const payload = JSON.stringify({
            type: 'agent.event',
            to: 'web',
            data: { session_id: sessionId, ...event, event_cursor: eventCursor },
        });
        for (const ws of this.ctx.getWebSockets('web')) {
            const att = ws.deserializeAttachment() || {};
            if (!att.authenticated) continue;
            try { ws.send(payload); } catch {}
        }
    }

    sendToDevice(deviceId, message) {
        if (!deviceId) return false;
        const targets = this.ctx.getWebSockets(`desktop:${deviceId}`);
        if (!targets.length) return false;
        try {
            targets[targets.length - 1].send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    }

    // 有回复在跑时定时给自己发 alarm：DO 长时间没有事件会被回收，alarm 相当于心跳。
    keepAlive() {
        this.ctx.storage.getAlarm()
            .then((at) => { if (!at || at > Date.now() + 20 * 1000) return this.ctx.storage.setAlarm(Date.now() + 20 * 1000); })
            .catch(() => {});
    }

    scheduleNotificationAlarm(at) {
        this.ctx.waitUntil(this.ctx.storage.getAlarm()
            .then((current) => { if (!current || current > at) return this.ctx.storage.setAlarm(at); })
            .catch((error) => console.error('任务通知 alarm 失败：', error.message)));
    }

    async alarm() {
        this.ctx.waitUntil(flushTaskNotifications(this.agentContext()));
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

    // to: 'web' 全部已登录网页；'web:<clientId>' 某个网页；'device:<id>' 某台电脑；'all' 所有人。
    route(msg) {
        const target = msg.to;
        let targets = [];

        if (target === 'all') {
            targets = this.ctx.getWebSockets();
        } else if (target === 'web') {
            targets = this.ctx.getWebSockets('web').filter((ws) => {
                const att = ws.deserializeAttachment() || {};
                return Boolean(att.authenticated);
            });
        } else if (typeof target === 'string' && target.startsWith('web:')) {
            const ws = this.findWebSocket(target.slice(4));
            if (ws) targets = [ws];
        } else if (typeof target === 'string' && target.startsWith('device:')) {
            // 只有网页会往设备发消息；设备之间不互发。
            if (msg.meta?.device === 'web') targets = this.ctx.getWebSockets(`desktop:${target.slice(7)}`);
        }

        if (!targets.length) return;
        const payload = JSON.stringify(msg);
        for (const ws of targets) {
            try {
                ws.send(payload);
            } catch {}
        }
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/ws' || url.pathname.startsWith('/api/agent/')) {
            if (url.pathname === '/ws' && url.searchParams.get('device') === 'desktop' && !(await deviceTokenValid(request, env))) {
                return new Response('Invalid device token', { status: 401 });
            }
            const id = env.TERMINAL_SESSION_MANAGER.idFromName(HUB);
            const stub = env.TERMINAL_SESSION_MANAGER.get(id);
            if (url.pathname.startsWith('/api/agent/')) {
                try { return await stub.fetch(await bufferAgentRequest(request)); }
                catch (error) { return jsonResponse({ ok: false, error: error.status ? error.message : '请求内容读取失败' }, error.status || 400); }
            }
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

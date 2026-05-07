import http from 'http';
import { randomUUID } from 'crypto';
import {
    BROWSER_EXTENSION_HOST,
    BROWSER_EXTENSION_PORT,
    DEBUG,
} from '../../core/env.js';

const SERVICE_URL = `http://${BROWSER_EXTENSION_HOST}:${BROWSER_EXTENSION_PORT}`;

const state = {
    serverId: randomUUID(),
    startedAt: null,
    lastRegisterAt: null,
    lastHeartbeatAt: null,
    extension: null,
    commands: [],
};

let server = null;

function json(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload));
}

function isLoopback(address) {
    return address === '127.0.0.1' ||
        address === '::1' ||
        address === '::ffff:127.0.0.1';
}

function snapshot() {
    return {
        serverId: state.serverId,
        startedAt: state.startedAt,
        lastRegisterAt: state.lastRegisterAt,
        lastHeartbeatAt: state.lastHeartbeatAt,
        extension: state.extension,
        commands: state.commands.map(summarizeCommand),
    };
}

function summarizeCommand(command) {
    return {
        id: command.id,
        type: command.type,
        status: command.status,
        createdAt: command.createdAt,
        dispatchedAt: command.dispatchedAt || null,
        completedAt: command.completedAt || null,
        error: command.error || null,
        result: command.result ?? null,
    };
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.setEncoding('utf8');

        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                reject(new Error('Request body too large.'));
                req.destroy();
            }
        });

        req.on('end', () => {
            if (!body) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error('Invalid JSON body.'));
            }
        });

        req.on('error', reject);
    });
}

function createCommand(type, payload) {
    const now = new Date().toISOString();
    const command = {
        id: randomUUID(),
        type,
        payload: payload || {},
        status: 'queued',
        createdAt: now,
        dispatchedAt: null,
        completedAt: null,
        result: null,
        error: null,
    };
    state.commands.push(command);
    return command;
}

function findCommand(id) {
    return state.commands.find((command) => command.id === id) || null;
}

function claimNextCommand() {
    const command = state.commands.find((entry) => entry.status === 'queued');
    if (!command) return null;

    command.status = 'dispatched';
    command.dispatchedAt = new Date().toISOString();
    return command;
}

function completeCommand(id, body) {
    const command = findCommand(id);
    if (!command) {
        return null;
    }

    command.status = body?.ok === false ? 'failed' : 'completed';
    command.completedAt = new Date().toISOString();
    command.result = body?.result ?? null;
    command.error = body?.ok === false ? (body?.error || 'Unknown command failure.') : null;
    return command;
}

async function handle(req, res) {
    if (!isLoopback(req.socket.remoteAddress)) {
        json(res, 403, { ok: false, error: 'Loopback only.' });
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { ok: true, bridge: 'browser', ...snapshot() });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
        json(res, 200, { ok: true, ...snapshot() });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/commands/next') {
        const command = claimNextCommand();
        json(res, 200, { ok: true, command: command ? summarizeCommand(command) : null, payload: command?.payload || null });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/commands') {
        const body = await readJson(req);
        const type = String(body?.type || '').trim();
        if (!type) {
            json(res, 400, { ok: false, error: 'Missing command type.' });
            return;
        }

        const command = createCommand(type, body?.payload || {});
        json(res, 200, { ok: true, command: summarizeCommand(command) });
        return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/commands/')) {
        const id = url.pathname.slice('/commands/'.length);
        const command = findCommand(id);
        if (!command) {
            json(res, 404, { ok: false, error: 'Command not found.' });
            return;
        }
        json(res, 200, { ok: true, command: summarizeCommand(command) });
        return;
    }

    if (req.method === 'POST' && url.pathname.endsWith('/result') && url.pathname.startsWith('/commands/')) {
        const id = url.pathname.slice('/commands/'.length, -'/result'.length);
        const body = await readJson(req);
        const command = completeCommand(id, body);
        if (!command) {
            json(res, 404, { ok: false, error: 'Command not found.' });
            return;
        }
        json(res, 200, { ok: true, command: summarizeCommand(command) });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/extension/register') {
        const body = await readJson(req);
        state.extension = {
            id: body.id || null,
            version: body.version || null,
            name: body.name || null,
        };
        state.lastRegisterAt = new Date().toISOString();
        state.lastHeartbeatAt = state.lastRegisterAt;
        json(res, 200, { ok: true, serverId: state.serverId });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/extension/heartbeat') {
        const body = await readJson(req);
        state.lastHeartbeatAt = new Date().toISOString();
        if (body?.tab) {
            state.extension = {
                ...(state.extension || {}),
                lastTab: body.tab,
            };
        }
        json(res, 200, { ok: true, serverId: state.serverId });
        return;
    }

    json(res, 404, { ok: false, error: 'Not found.' });
}

function start() {
    if (server) return Promise.resolve(server);

    state.startedAt = new Date().toISOString();
    server = http.createServer((req, res) => {
        handle(req, res).catch((error) => {
            if (DEBUG) {
                console.error('[browser] request error:', error);
            }
            json(res, 500, { ok: false, error: error.message || String(error) });
        });
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(BROWSER_EXTENSION_PORT, BROWSER_EXTENSION_HOST, () => {
            server.off('error', reject);
            resolve(server);
        });
    });
}

function stop() {
    if (!server) return Promise.resolve();

    const current = server;
    server = null;

    return new Promise((resolve, reject) => {
        current.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

export { start, stop, snapshot, SERVICE_URL as serviceUrl };
export default {
    start,
    stop,
    snapshot,
    serviceUrl: SERVICE_URL,
};

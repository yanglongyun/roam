// 浏览器能力:浏览器插件经原生消息宿主(native-host.js)连到这个本机管道,电脑端把 browser 工具的命令转给插件。
//
//   browser 工具 ──▶ 电脑端 ── 管道 ──▶ 宿主 ── stdio ──▶ 插件 ──▶ 网页
//
// 管道上每行一个 JSON:电脑端发 { id, action, args },插件回 { id, result } 或 { id, error }。
// 只有当前用户能连这个管道,所以不需要令牌。
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const TIMEOUT_MS = 30_000;

/** 返回 browser 工具用的 { request(action, args, signal), connected(), close() }。 */
export function startBrowser({ address, log = console.log }) {
    const sockets = [];
    const pending = new Map();

    function receive(line) {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.result);
    }

    const server = net.createServer((socket) => {
        sockets.push(socket);
        socket.setEncoding('utf8');
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk;
            let index = buffer.indexOf('\n');
            while (index >= 0) {
                receive(buffer.slice(0, index));
                buffer = buffer.slice(index + 1);
                index = buffer.indexOf('\n');
            }
        });
        socket.on('close', () => {
            sockets.splice(sockets.indexOf(socket), 1);
            log('🧩 浏览器插件已断开');
        });
        socket.on('error', () => {});
        log('🧩 浏览器插件已连接');
    });
    server.on('error', (error) => log('🧩 浏览器管道不可用:', error.message, address));
    // 上次异常退出可能留下 socket 文件,监听前先删掉
    if (!address.startsWith('\\\\')) {
        fs.mkdirSync(path.dirname(address), { recursive: true, mode: 0o700 });
        fs.rmSync(address, { force: true });
    }
    server.listen(address);
    server.unref();

    /** 发一条命令给最近连上的插件,等它回结果。 */
    function request(action, args = {}, signal) {
        signal?.throwIfAborted();
        const socket = sockets.at(-1);
        if (!socket) return Promise.reject(new Error('浏览器插件未连接：请在 Chrome 或 Edge 里安装并启用 Roam 插件'));
        if (typeof action !== 'string' || !action) return Promise.reject(new Error('缺少 action'));
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('浏览器插件没有响应')); }, TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            socket.write(`${JSON.stringify({ id, action, args })}\n`);
        });
    }

    return {
        request,
        connected: () => sockets.length > 0,
        close() {
            for (const socket of sockets) socket.destroy();
            server.close();
        },
    };
}

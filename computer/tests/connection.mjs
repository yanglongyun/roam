import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { createConnection } from '../core/connection.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
    const end = Date.now() + 6000;
    while (Date.now() < end) { if (predicate()) return; await wait(10); }
    throw new Error(`超时：${label}`);
}
let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log(`✓ ${label}`); };
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await once(server, 'listening');
const connections = [], logs = [], received = [];
server.on('connection', (socket, req) => {
    connections.push({ socket, url: req.url, token: req.headers.authorization });
    socket.on('message', (raw) => received.push(JSON.parse(raw)));
});
let opened = 0, closed = 0;
const client = createConnection({ serverUrl: `ws://127.0.0.1:${server.address().port}`, webUrl: 'http://test.local', token: 'test-token', id: 'test-device', log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) });
const init = () => client.init({ onOpen: () => opened++, onClose: () => closed++ });
try {
    init();
    await until(() => opened === 1, 'first connection');
    client.sendToClient('viewer', 'screen.result', { ok: true });
    await until(() => received.length > 0, 'private reply');
    check('设备身份与私有消息路由保持正确', () => {
        assert.match(connections[0].url, /device_id=test-device/);
        assert.equal(connections[0].token, 'Bearer test-token');
        assert.equal(received[0].to, 'web:viewer');
    });
    assert.throws(init, /已经启动/);
    check('同一连接对象不能重复启动网络连接', () => assert.equal(connections.length, 1));
    connections[0].socket.close(1001, 'network interrupted');
    await until(() => opened === 2, 'network reconnect');
    check('普通网络断线仍按原行为自动重连', () => {
        assert.equal(connections.length, 2);
        assert.equal(closed, 1);
    });
    connections[1].socket.close(4002, 'replaced');
    await until(() => closed === 2, 'duplicate close');
    await wait(3300);
    check('被另一实例替换后停止重连，不再反复抢占设备', () => {
        assert.equal(connections.length, 2);
        assert.ok(logs.some((line) => line.includes('已停止自动重连')));
    });
    init();
    await until(() => opened === 3, 'explicit restart');
    client.close();
    await until(() => closed === 3, 'intentional close');
    await wait(3300);
    check('主动关闭连接不会被 close 回调重新连起', () => assert.equal(connections.length, 3));
} finally {
    client.close();
    for (const { socket } of connections) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
}
console.log(`\n${checks} 项连接生命周期检查全部通过`);

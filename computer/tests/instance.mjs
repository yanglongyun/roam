import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { acquireInstance } from '../core/single-instance.js';

if (process.argv[2] === 'child') {
    const lock = acquireInstance({ directory: process.argv[3] });
    if (lock.acquired) {
        process.once('exit', lock.release);
        process.on('message', () => { lock.release(); process.exit(0); });
    }
    process.send({ acquired: lock.acquired, pid: process.pid, owner: lock.pid });
    if (!lock.acquired) process.disconnect();
} else {
    let checks = 0;
    const check = (label, fn) => { fn(); checks++; console.log(`✓ ${label}`); };
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-instance-'));
    const children = [];
    function start(directory = root) {
        const child = fork(fileURLToPath(import.meta.url), ['child', directory], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        children.push(child);
        let errors = '';
        child.stderr.on('data', (chunk) => { errors += chunk; });
        const ended = once(child, 'exit');
        const ready = new Promise((resolve, reject) => {
            child.once('message', (result) => resolve({ child, result, ended }));
            child.once('error', reject);
            child.once('exit', (code) => { if (code) reject(new Error(errors || `子进程退出 ${code}`)); });
        });
        return ready;
    }
    try {
        const contenders = await Promise.all(Array.from({ length: 8 }, () => start()));
        const owners = contenders.filter(({ result }) => result.acquired);
        check('多个进程同时启动时只有一个获得运行锁', () => assert.equal(owners.length, 1));
        let owner = owners[0];
        const duplicate = await start();
        const [duplicateCode] = await duplicate.ended;
        check('重复实例正常退出，并识别仍在运行的原进程', () => {
            assert.equal(duplicate.result.acquired, false);
            assert.equal(duplicateCode, 0);
            if (process.platform !== 'win32') assert.equal(duplicate.result.owner, owner.result.pid);
            assert.equal(owner.child.exitCode, null);
        });
        owner.child.send('release');
        await owner.ended;
        owner = await start();
        check('正常关闭后下一次启动可立即取得运行锁', () => assert.equal(owner.result.acquired, true));
        owner.child.kill('SIGKILL');
        await owner.ended;
        const stale = await fs.readFile(path.join(root, 'computer.lock'), 'utf8');
        const restarted = await start();
        check('强制退出即释放系统锁，旧 PID 文件不会阻止重启', () => {
            assert.equal(stale.trim(), String(owner.result.pid));
            assert.equal(restarted.result.acquired, true);
        });
        const independent = await start(path.join(root, 'another-user'));
        check('独立用户目录互不抢锁', () => assert.equal(independent.result.acquired, true));
        restarted.child.send('release'); independent.child.send('release');
        await Promise.all([restarted.ended, independent.ended]);
        const local = acquireInstance({ directory: root });
        local.release(); local.release();
        check('清理重复调用不会关闭其他资源', () => assert.equal(local.acquired, true));
    } finally {
        await Promise.all(children.map(async (child) => {
            if (child.exitCode !== null || child.signalCode) return;
            const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
        }));
        await fs.rm(root, { recursive: true, force: true });
    }
    console.log(`\n${checks} 项单实例检查全部通过`);
}

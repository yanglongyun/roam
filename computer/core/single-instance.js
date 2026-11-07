import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import koffi from 'koffi';

// 锁由操作系统持有；进程退出就释放，不靠 PID 探测、心跳或删除旧锁文件。
export function acquireInstance({ directory = path.join(os.homedir(), '.roam') } = {}) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, 'computer.lock');
    let release, record;
    if (process.platform === 'win32') {
        const kernel = koffi.load('kernel32.dll');
        const create = kernel.func('void * __stdcall CreateMutexW(void *attributes, int owner, str16 name)');
        const lastError = kernel.func('uint32_t __stdcall GetLastError(void)');
        const close = kernel.func('int __stdcall CloseHandle(void *handle)');
        const name = createHash('sha256').update(path.resolve(directory).toLowerCase()).digest('hex');
        const handle = create(null, 0, `Local\\RoamComputer_${name}`);
        const code = lastError();
        if (!handle) throw new Error(`无法检查 Computer 运行状态（系统错误 ${code}）`);
        if (code === 183) { close(handle); return { acquired: false }; }
        release = () => close(handle);
        record = () => fs.writeFileSync(file, String(process.pid) + '\n', { mode: 0o600 });
    } else {
        const system = koffi.load(null);
        const flock = system.func('int flock(int fd, int operation)');
        const fd = fs.openSync(file, 'a+', 0o600);
        if (flock(fd, 2 | 4) !== 0) { // LOCK_EX | LOCK_NB
            const code = koffi.errno();
            fs.closeSync(fd);
            if (code === koffi.os.errno.EWOULDBLOCK || code === koffi.os.errno.EAGAIN) {
                let pid;
                try { pid = Number(fs.readFileSync(file, 'utf8').trim()); } catch {}
                return { acquired: false, pid: Number.isSafeInteger(pid) && pid > 0 ? pid : undefined };
            }
            throw new Error(`无法检查 Computer 运行状态（系统错误 ${code}）`);
        }
        // 不能 unlink 锁文件：其他进程可能已打开同一个 inode 并等待检查。
        release = () => fs.closeSync(fd);
        record = () => { fs.ftruncateSync(fd, 0); fs.writeSync(fd, String(process.pid) + '\n'); };
    }
    let released = false;
    const unlock = () => { if (!released) { released = true; release(); } };
    try { record(); } catch (error) { unlock(); throw error; }
    return { acquired: true, release: unlock };
}

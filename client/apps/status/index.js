import os from 'os';
import { execFile } from 'child_process';
import ws from '../../server/ws.js';

function cpuTotals() {
    const cpus = os.cpus() || [];
    let idle = 0;
    let total = 0;
    for (const c of cpus) {
        const t = c.times;
        const sum = t.user + t.nice + t.sys + t.idle + t.irq;
        idle += t.idle;
        total += sum;
    }
    return { idle, total, count: cpus.length, model: cpus[0]?.model || '', speed: cpus[0]?.speed || 0 };
}

async function cpuUsagePercent(sampleMs = 200) {
    const a = cpuTotals();
    await new Promise((r) => setTimeout(r, sampleMs));
    const b = cpuTotals();
    const idleDiff = b.idle - a.idle;
    const totalDiff = b.total - a.total;
    if (totalDiff <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 1000) / 10));
}

function memInfo() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
        total,
        free,
        used,
        percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    };
}

function netInterfaces() {
    const ifs = os.networkInterfaces() || {};
    const out = [];
    for (const [name, addrs] of Object.entries(ifs)) {
        for (const a of addrs || []) {
            if (a.internal) continue;
            if (a.family !== 'IPv4' && a.family !== 4) continue;
            out.push({ name, address: a.address, mac: a.mac });
        }
    }
    return out;
}

function runDfRoot() {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            resolve(null);
            return;
        }
        execFile('df', ['-k', '/'], { timeout: 3000 }, (err, stdout) => {
            if (err) return resolve(null);
            const lines = String(stdout).trim().split(/\n/);
            const last = lines[lines.length - 1] || '';
            const parts = last.split(/\s+/).filter(Boolean);
            // 兼容 darwin/linux 列序: Filesystem 1024-blocks Used Available Capacity ... Mounted-on
            // 最后一段是 mount,倒数取 capacity 通常是 N% 或 N
            const total = Number(parts[1]) * 1024;
            const used = Number(parts[2]) * 1024;
            const avail = Number(parts[3]) * 1024;
            if (!Number.isFinite(total) || total <= 0) return resolve(null);
            resolve({
                mount: '/',
                total,
                used,
                free: avail,
                percent: Math.round((used / total) * 1000) / 10,
            });
        });
    });
}

async function snapshot() {
    const [cpuPercent, disk] = await Promise.all([
        cpuUsagePercent(200),
        runDfRoot(),
    ]);
    const cpus = cpuTotals();
    return {
        capturedAt: Date.now(),
        host: {
            hostname: os.hostname(),
            platform: os.platform(),
            release: os.release(),
            arch: os.arch(),
            uptime: os.uptime(),
        },
        cpu: {
            count: cpus.count,
            model: cpus.model,
            speed: cpus.speed,
            usagePercent: cpuPercent,
            loadavg: os.loadavg(),
        },
        mem: memInfo(),
        disk,
        network: netInterfaces(),
    };
}

async function handle(message) {
    const t = message.type;
    const reqId = message.data?.reqId;
    const clientId = message.meta?.clientId || null;

    try {
        switch (t) {
            case 'status.request': {
                const data = await snapshot();
                if (clientId) {
                    ws.sendToClient(clientId, 'status.result', { reqId, ok: true, ...data });
                } else {
                    ws.broadcast('status.result', { reqId, ok: true, ...data });
                }
                return true;
            }
            default:
                return false;
        }
    } catch (err) {
        const payload = { reqId, ok: false, error: err?.message || String(err) };
        if (clientId) ws.sendToClient(clientId, 'status.result', payload);
        else ws.broadcast('status.result', payload);
        return true;
    }
}

export { handle };
export default { handle };

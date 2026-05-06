const fsp = require('fs').promises;
const path = require('path');
const ws = require('../../core/ws');
const response = require('../core/response');
const uploads = require('../core/uploads');

async function start(reqId, p, size, overwrite) {
    if (!overwrite) {
        let exists = false;
        try {
            await fsp.access(p);
            exists = true;
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
        if (exists) throw new Error('文件已存在，传 overwrite=true 覆盖');
    }
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const fd = await fsp.open(p, 'w');
    uploads.set(reqId, { path: p, size, received: 0, fd, expectedSeq: 0 });
    response.ok(reqId, { path: p, ready: true });
}

async function chunk(reqId, seq, dataB64, eof) {
    const up = uploads.get(reqId);
    if (!up) throw new Error('上传会话不存在');
    try {
        if (seq !== up.expectedSeq) throw new Error(`序号错位 expected=${up.expectedSeq} got=${seq}`);
        const buf = Buffer.from(dataB64 || '', 'base64');
        if (buf.length) await up.fd.write(buf);
        up.received += buf.length;
        up.expectedSeq++;
        if (eof) {
            await up.fd.close();
            uploads.remove(reqId);
            response.ok(reqId, { path: up.path, received: up.received, completed: true });
        } else {
            ws.broadcast('fs.upload.ack', { reqId, received: up.received });
        }
    } catch (err) {
        await up.fd.close().catch(() => {});
        await fsp.unlink(up.path).catch(() => {});
        uploads.remove(reqId);
        throw err;
    }
}

async function abort(reqId) {
    const up = uploads.get(reqId);
    if (up) {
        await up.fd.close().catch(() => {});
        await fsp.unlink(up.path).catch(() => {});
        uploads.remove(reqId);
    }
    response.ok(reqId, { aborted: true });
}

module.exports = { start, chunk, abort };

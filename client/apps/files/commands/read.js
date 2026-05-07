import { promises as fsp } from 'fs';
import path from 'path';
import ws from '../../../server/ws.js';
import { guessMime } from '../../../core/mime.js';

const READ_CHUNK = 256 * 1024;
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;

async function read(reqId, p, maxSize) {
    const limit = Math.min(maxSize || MAX_PREVIEW_BYTES, MAX_PREVIEW_BYTES);
    const st = await fsp.stat(p);
    if (st.isDirectory()) throw new Error('是目录，不能读取');
    if (st.size > limit) throw new Error(`文件过大 (${st.size} 字节 / 上限 ${limit})`);

    const name = path.basename(p);
    const mime = guessMime(name);
    ws.broadcast('fs.read.meta', { reqId, name, size: st.size, mime });

    const fd = await fsp.open(p, 'r');
    try {
        let offset = 0;
        let seq = 0;
        while (offset < st.size) {
            const len = Math.min(READ_CHUNK, st.size - offset);
            const buf = Buffer.alloc(len);
            const { bytesRead } = await fd.read(buf, 0, len, offset);
            if (bytesRead <= 0) break;
            offset += bytesRead;
            ws.broadcast('fs.read.chunk', {
                reqId,
                seq,
                data: buf.subarray(0, bytesRead).toString('base64'),
                eof: offset >= st.size,
            });
            seq++;
        }
        if (st.size === 0) {
            ws.broadcast('fs.read.chunk', { reqId, seq: 0, data: '', eof: true });
        }
    } finally {
        await fd.close();
    }
}

export { read };
export default { read };
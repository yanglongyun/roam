import { promises as fsp } from 'fs';
import response from '../core/response.js';

async function stat(reqId, p) {
    const st = await fsp.stat(p);
    response.ok(reqId, {
        path: p,
        type: st.isDirectory() ? 'dir' : 'file',
        size: st.size,
        mtime: st.mtimeMs,
    });
}

export { stat };
export default { stat };
import { promises as fsp } from 'fs';
import response from '../core/response.js';

async function del(reqId, p, recursive) {
    const st = await fsp.stat(p);
    if (st.isDirectory()) {
        if (!recursive) throw new Error('是目录，需 recursive=true');
        await fsp.rm(p, { recursive: true, force: true });
    } else {
        await fsp.unlink(p);
    }
    response.ok(reqId);
}

export { del as delete };
export default { delete: del };
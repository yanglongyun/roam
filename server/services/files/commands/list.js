import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import response from '../core/response.js';

async function list(reqId, p, showHidden) {
    const abs = p || os.homedir();
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const items = await Promise.all(entries
        .filter((e) => showHidden || !e.name.startsWith('.'))
        .map(async (e) => {
            const full = path.join(abs, e.name);
            try {
                const st = await fsp.stat(full);
                return {
                    name: e.name,
                    type: st.isDirectory() ? 'dir' : (e.isSymbolicLink() ? 'link' : 'file'),
                    size: st.size,
                    mtime: st.mtimeMs,
                };
            } catch {
                return { name: e.name, type: 'unknown', size: 0, mtime: 0 };
            }
        }));
    items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    response.ok(reqId, { path: abs, entries: items });
}

export { list };
export default { list };
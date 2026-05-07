import response from './core/response.js';
import { home } from './commands/home.js';
import { list } from './commands/list.js';
import { stat } from './commands/stat.js';
import { read } from './commands/read.js';
import { delete as del } from './commands/delete.js';
import { mkdir } from './commands/mkdir.js';
import { rename } from './commands/rename.js';
import upload from './commands/upload.js';

async function handle(message) {
    const t = message.type;
    const d = message.data || {};
    const reqId = d.reqId;

    try {
        switch (t) {
            case 'fs.home':             home(reqId); return true;
            case 'fs.list':             await list(reqId, d.path, d.showHidden); return true;
            case 'fs.stat':             await stat(reqId, d.path); return true;
            case 'fs.read':             await read(reqId, d.path, d.maxSize); return true;
            case 'fs.delete':           await del(reqId, d.path, d.recursive); return true;
            case 'fs.mkdir':            await mkdir(reqId, d.path); return true;
            case 'fs.rename':           await rename(reqId, d.from, d.to); return true;
            case 'fs.upload.start':     await upload.start(reqId, d.path, d.size, d.overwrite); return true;
            case 'fs.upload.chunk':     await upload.chunk(reqId, d.seq, d.data, d.eof); return true;
            case 'fs.upload.abort':     await upload.abort(reqId); return true;
            default:
                response.err(reqId, t, `未知 fs 操作: ${t}`);
                return true;
        }
    } catch (err) {
        response.err(reqId, t, err.message || String(err));
        return true;
    }
}

export { handle };
export default { handle };

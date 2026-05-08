import { promises as fsp } from 'fs';
import response from '../core/response.js';

async function mkdir(reqId, p) {
    await fsp.mkdir(p, { recursive: true });
    response.ok(reqId, { path: p });
}

export { mkdir };
export default { mkdir };
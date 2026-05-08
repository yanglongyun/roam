import { promises as fsp } from 'fs';
import response from '../core/response.js';

async function rename(reqId, from, to) {
    await fsp.rename(from, to);
    response.ok(reqId, { from, to });
}

export { rename };
export default { rename };
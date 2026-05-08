import os from 'os';
import path from 'path';
import response from '../core/response.js';

function home(reqId) {
    response.ok(reqId, { path: os.homedir(), sep: path.sep, platform: os.platform() });
}

export { home };
export default { home };
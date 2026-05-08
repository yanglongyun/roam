import ws from '../../../ws.js';

function ok(reqId, payload = {}) {
    ws.broadcast('fs.result', { reqId, ok: true, ...payload });
}

function err(reqId, op, message) {
    console.error(`fs 错误 [${op}]:`, message);
    ws.broadcast('fs.result', { reqId, ok: false, error: message });
}

export { ok, err };
export default { ok, err };
const fsp = require('fs').promises;
const response = require('../core/response');

async function stat(reqId, p) {
    const st = await fsp.stat(p);
    response.ok(reqId, {
        path: p,
        type: st.isDirectory() ? 'dir' : 'file',
        size: st.size,
        mtime: st.mtimeMs,
    });
}

module.exports = { stat };

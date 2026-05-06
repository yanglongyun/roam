const fsp = require('fs').promises;
const response = require('../core/response');

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

module.exports = { delete: del };

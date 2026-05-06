const fsp = require('fs').promises;
const response = require('../core/response');

async function mkdir(reqId, p) {
    await fsp.mkdir(p, { recursive: true });
    response.ok(reqId, { path: p });
}

module.exports = { mkdir };

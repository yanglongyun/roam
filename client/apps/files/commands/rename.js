const fsp = require('fs').promises;
const response = require('../core/response');

async function rename(reqId, from, to) {
    await fsp.rename(from, to);
    response.ok(reqId, { from, to });
}

module.exports = { rename };

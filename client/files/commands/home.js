const os = require('os');
const path = require('path');
const response = require('../core/response');

function home(reqId) {
    response.ok(reqId, { path: os.homedir(), sep: path.sep, platform: os.platform() });
}

module.exports = { home };

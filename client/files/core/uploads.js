const uploads = new Map();  // reqId -> { path, size, received, fd, expectedSeq }

function set(reqId, record) { uploads.set(reqId, record); }
function get(reqId) { return uploads.get(reqId); }
function remove(reqId) { uploads.delete(reqId); }

module.exports = { set, get, remove };

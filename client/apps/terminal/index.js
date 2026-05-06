const sessions = require('./core/sessions');
const { create } = require('./commands/create');
const { activate } = require('./commands/activate');
const { close } = require('./commands/close');
const { input } = require('./commands/input');
const { resize } = require('./commands/resize');
const systemCommand = require('./commands/system_command');

async function handle(message) {
    const t = message.type;
    const d = message.data || {};

    try {
        switch (t) {
            case 'terminal.list':
                sessions.broadcastList();
                return true;
            case 'terminal.create': {
                const terminal = await create(d);
                // sessions.create 已经广播 created / init
                // create() 中额外补 activated
                return true;
            }
            case 'terminal.activate':
                activate(d.terminalId);
                return true;
            case 'terminal.close':
                await close(d.terminalId);
                return true;
            case 'data.input':
                input(d.terminalId, d.input);
                return true;
            case 'system.init':
            case 'system.resize':
                resize(d.terminalId, d.cols, d.rows);
                return true;
            case 'system.command':
                await systemCommand.run(d.command, d.terminalId);
                return true;
            default:
                return false;
        }
    } catch (err) {
        sessions.broadcastError(err.message || String(err), d.terminalId || null);
        return true;
    }
}

// 暴露给 index.js / guard grant 使用的快照接口
function sendSnapshotTo(clientId) {
    sessions.broadcastList(`web:${clientId}`);
    const active = sessions.get();
    if (active) sessions.broadcastInit(active, `web:${clientId}`);
}

function sendSnapshotAll() {
    sessions.broadcastList();
    const active = sessions.get();
    if (active) sessions.broadcastInit(active);
}

module.exports = {
    handle,
    sendSnapshotTo,
    sendSnapshotAll,
    ensureDefault: () => create({}),
    shutdown: () => sessions.killAll(),
};

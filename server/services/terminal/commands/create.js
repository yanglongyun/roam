import sessions from '../core/sessions.js';
import ws from '../../../ws.js';

async function create(options = {}) {
    const terminal = await sessions.create(options);
    ws.broadcast('terminal.activated', { terminalId: terminal.id });
    return terminal;
}

export { create };
export default { create };
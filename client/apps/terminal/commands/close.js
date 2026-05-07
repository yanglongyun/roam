import sessions from '../core/sessions.js';

async function close(terminalId) {
    await sessions.close(terminalId, { ensureOne: true });
}

export { close };
export default { close };
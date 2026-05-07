import sessions from '../core/sessions.js';

function resize(terminalId, cols, rows) {
    sessions.resize(terminalId, cols, rows);
}

export { resize };
export default { resize };
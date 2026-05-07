import sessions from '../core/sessions.js';

function activate(terminalId) {
    sessions.activate(terminalId);
}

export { activate };
export default { activate };
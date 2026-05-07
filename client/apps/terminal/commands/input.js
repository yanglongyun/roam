import sessions from '../core/sessions.js';

function input(terminalId, text) {
    sessions.write(terminalId, text);
}

export { input };
export default { input };
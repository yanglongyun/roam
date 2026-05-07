import { runCommand } from './request.js';

export default async function detach({ timeoutSeconds = 15 } = {}) {
    return runCommand('detach', {}, timeoutSeconds);
};

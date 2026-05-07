import { runCommand } from './request.js';

export default async function attach({ timeoutSeconds = 15 } = {}) {
    return runCommand('attach', {}, timeoutSeconds);
};

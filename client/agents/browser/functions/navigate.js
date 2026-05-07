import { runCommand } from './request.js';

export default async function navigate({ url, timeoutSeconds = 15 } = {}) {
    if (!url) throw new Error('缺少 url');
    return runCommand('navigate', { url }, timeoutSeconds);
};

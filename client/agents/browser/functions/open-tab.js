import { runCommand } from './request.js';

export default async function openTab({ url, timeoutSeconds = 15 } = {}) {
    if (!url) throw new Error('缺少 url');
    return runCommand('open-tab', { url }, timeoutSeconds);
};

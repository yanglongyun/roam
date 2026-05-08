import os from 'os';
import path from 'path';
import fs from 'fs';
const fsp = fs.promises;

function getDefaultShell() {
    return os.platform() === 'win32'
        ? 'powershell.exe'
        : (process.env.SHELL || 'bash');
}

function getDefaultDirectory() {
    const desktop = path.join(os.homedir(), 'Desktop');
    return fs.existsSync(desktop) ? desktop : os.homedir();
}

async function ensureDirectory(cwd) {
    const target = cwd && String(cwd).trim() ? String(cwd).trim() : getDefaultDirectory();
    const resolved = path.resolve(target);
    const st = await fsp.stat(resolved);
    if (!st.isDirectory()) throw new Error('启动目录不是文件夹');
    return resolved;
}

export { getDefaultShell, getDefaultDirectory, ensureDirectory };
export default { getDefaultShell, getDefaultDirectory, ensureDirectory };
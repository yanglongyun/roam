const os = require('os');
const { spawn } = require('child_process');
const { getDefaultShell, ensureDirectory, getDefaultDirectory } = require('../../../apps/terminal/core/shell');

module.exports = async function terminal({ command, cwd, timeoutSeconds = 30 } = {}, { signal } = {}) {
    if (!command) throw new Error('缺少 command');

    const workingDir = await ensureDirectory(cwd || getDefaultDirectory());
    const shell = getDefaultShell();
    const shellArgs = os.platform() === 'win32' ? ['-Command', command] : ['-lc', command];

    return new Promise((resolve, reject) => {
        let finished = false;
        let timer = null;
        const finish = (fn, value) => {
            if (finished) return;
            finished = true;
            if (timer) clearTimeout(timer);
            fn(value);
        };

        const child = spawn(shell, shellArgs, { cwd: workingDir, env: process.env });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (err) => finish(reject, err));
        child.on('close', (code, sig) => {
            finish(resolve, {
                cwd: workingDir,
                exitCode: code,
                signal: sig,
                stdout,
                stderr,
            });
        });

        timer = setTimeout(() => {
            child.kill('SIGTERM');
            finish(reject, new Error(`命令超时 (${timeoutSeconds}s)`));
        }, Math.max(1, Number(timeoutSeconds) || 30) * 1000);

        if (signal) {
            const onAbort = () => {
                child.kill('SIGTERM');
                finish(reject, new Error('命令已取消'));
            };
            if (signal.aborted) onAbort();
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
};

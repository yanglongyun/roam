const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const ENHANCED_PATH = [
    path.join(os.homedir(), '.claude', 'local'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env.PATH || '',
].filter(Boolean).join(':');

const claudeEnv = () => ({ ...process.env, PATH: ENHANCED_PATH });

function getClaudeStatus() {
    return new Promise((resolve) => {
        let stdout = '';
        const child = spawn('claude', ['--version'], {
            shell: false,
            windowsHide: true,
            env: claudeEnv(),
        });
        child.stdout?.on('data', (d) => (stdout += d.toString()));
        child.on('error', () => resolve({ installed: false, version: null }));
        child.on('close', (code) => {
            resolve({
                installed: code === 0,
                version: code === 0 ? stdout.trim() : null,
            });
        });
    });
}

module.exports = { getClaudeStatus, claudeEnv, ENHANCED_PATH };

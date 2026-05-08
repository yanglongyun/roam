import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import ws from '../../ws.js';

function runFile(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr;
                reject(err);
                return;
            }
            resolve(stdout);
        });
    });
}

async function captureToTemp(command, args) {
    const file = path.join(os.tmpdir(), `roam-screen-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    try {
        await runFile(command, args(file), { timeout: 15000 });
        return await fsp.readFile(file);
    } finally {
        fsp.unlink(file).catch(() => {});
    }
}

async function capturePng() {
    if (process.platform === 'darwin') {
        return captureToTemp('screencapture', (file) => ['-x', '-t', 'png', file]);
    }

    if (process.platform === 'win32') {
        const script = [
            'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
            '$bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;',
            '$bmp=New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height;',
            '$graphics=[System.Drawing.Graphics]::FromImage($bmp);',
            '$graphics.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size);',
            '$stream=New-Object System.IO.MemoryStream;',
            '$bmp.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png);',
            '[Convert]::ToBase64String($stream.ToArray());',
            '$graphics.Dispose();$bmp.Dispose();$stream.Dispose();',
        ].join('');
        const stdout = await runFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 15000, maxBuffer: 25 * 1024 * 1024 });
        return Buffer.from(String(stdout).trim(), 'base64');
    }

    const attempts = [
        ['gnome-screenshot', (file) => ['-f', file]],
        ['spectacle', (file) => ['-b', '-n', '-o', file]],
        ['scrot', (file) => [file]],
        ['import', (file) => ['-window', 'root', file]],
    ];
    let lastError;
    for (const [command, args] of attempts) {
        try {
            return await captureToTemp(command, args);
        } catch (err) {
            lastError = err;
        }
    }
    throw new Error(`当前系统没有可用截图命令: ${lastError?.message || 'unknown error'}`);
}

async function capture(reqId) {
    const png = await capturePng();
    ws.broadcast('screen.capture.result', {
        reqId,
        ok: true,
        mime: 'image/png',
        capturedAt: Date.now(),
        data: png.toString('base64'),
    });
}

async function handle(message) {
    const t = message.type;
    const d = message.data || {};
    const reqId = d.reqId;

    try {
        switch (t) {
            case 'screen.capture':
                await capture(reqId);
                return true;
            default:
                ws.broadcast('screen.capture.result', { reqId, ok: false, error: `未知 screen 操作: ${t}` });
                return true;
        }
    } catch (err) {
        console.error(`screen 错误 [${t}]:`, err.message || err);
        ws.broadcast('screen.capture.result', { reqId, ok: false, error: err.message || String(err) });
        return true;
    }
}

export { handle };
export default { handle };
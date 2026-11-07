import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { imageSize } from 'image-size';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const DEFAULT_MAX_SIDE = 1568;
const DEFAULT_JPEG_QUALITY = 55;

function commandError(command, args, err, stderr) {
    const detail = String(stderr || err?.stderr || err?.message || '').trim();
    const message = detail || `Command failed: ${command} ${args.join(' ')}`;
    const out = new Error(message);
    out.command = command;
    out.args = args;
    out.code = err?.code;
    out.stderr = detail;
    return out;
}

function runFile(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (err, stdout, stderr) => {
            if (err) {
                reject(commandError(command, args, err, stderr));
                return;
            }
            resolve(stdout);
        });
    });
}

async function readValidPng(file) {
    const buf = await fsp.readFile(file);
    if (buf.length < PNG_MAGIC.length || !buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        throw new Error('截图命令没有生成有效 PNG 图片');
    }
    return buf;
}

async function readValidJpeg(file) {
    const buf = await fsp.readFile(file);
    if (buf.length < JPEG_MAGIC.length || !buf.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
        throw new Error('截图压缩没有生成有效 JPEG 图片');
    }
    return buf;
}

async function captureToTemp(command, argsForFile, options = {}) {
    const file = path.join(os.tmpdir(), `roam-screen-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    try {
        await runFile(command, argsForFile(file), { timeout: 15000, maxBuffer: 64 * 1024 * 1024, ...options });
        return await readValidPng(file);
    } finally {
        fsp.unlink(file).catch(() => {});
    }
}

async function captureMacPng(signal) {
    const { ensureScreenAccess } = await import('./mac-screen-access.js');
    ensureScreenAccess();
    try {
        return await captureToTemp('/usr/sbin/screencapture', (file) => ['-x', '-m', '-t', 'png', file], { signal });
    } catch (err) {
        signal?.throwIfAborted();
        console.error('macOS 截图失败', err);
        if (err.code === 'ENOENT') throw new Error('系统截图程序不可用。');
        if (/could not create image from display|no display/i.test(err.stderr || '')) {
            throw new Error('当前桌面无法截图。请确认这台 Mac 已登录桌面，且有可用的显示器。');
        }
        throw new Error('系统截图失败，请重试。');
    }
}

async function captureWindowsPng(signal) {
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
    const stdout = await runFile('powershell.exe', ['-NoProfile', '-Command', script], {
        timeout: 15000,
        maxBuffer: 64 * 1024 * 1024,
        signal,
    });
    const buf = Buffer.from(String(stdout).trim(), 'base64');
    if (buf.length < PNG_MAGIC.length || !buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        throw new Error('PowerShell 截图没有生成有效 PNG 图片');
    }
    return buf;
}

async function captureLinuxPng(signal) {
    const attempts = [
        ['gnome-screenshot', (file) => ['-f', file]],
        ['spectacle', (file) => ['-b', '-n', '-o', file]],
        ['scrot', (file) => [file]],
        ['import', (file) => ['-window', 'root', file]],
    ];
    let lastError;
    for (const [command, args] of attempts) {
        try {
            return await captureToTemp(command, args, { signal });
        } catch (err) {
            signal?.throwIfAborted();
            lastError = err;
        }
    }
    throw new Error(`当前系统没有可用截图命令: ${lastError?.message || 'unknown error'}`);
}

async function capturePng(signal) {
    signal?.throwIfAborted();
    if (process.platform === 'darwin') return captureMacPng(signal);
    if (process.platform === 'win32') return captureWindowsPng(signal);
    return captureLinuxPng(signal);
}

async function compressPngForWire(png, options = {}) {
    const maxSide = Math.max(320, Math.min(4096, Number(options.maxSide) || DEFAULT_MAX_SIDE));
    const quality = Math.max(1, Math.min(100, Number(options.quality) || DEFAULT_JPEG_QUALITY));
    const tmpPng = path.join(os.tmpdir(), `roam-screen-src-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    const tmpJpg = `${tmpPng}.jpg`;
    try {
        await fsp.writeFile(tmpPng, png);
        if (process.platform === 'darwin') {
            await runFile('/usr/bin/sips', [
                '-Z', String(maxSide),
                '-s', 'format', 'jpeg',
                '-s', 'formatOptions', String(quality),
                tmpPng,
                '--out', tmpJpg,
            ], { timeout: 15000, maxBuffer: 64 * 1024 * 1024, signal: options.signal });
            return { buffer: await readValidJpeg(tmpJpg), mime: 'image/jpeg' };
        }
    } finally {
        fsp.unlink(tmpPng).catch(() => {});
        fsp.unlink(tmpJpg).catch(() => {});
    }
    return { buffer: png, mime: 'image/png' };
}

async function captureCompressed(options = {}) {
    const png = await capturePng(options.signal);
    options.signal?.throwIfAborted();
    const shot = await compressPngForWire(png, options);
    const { width, height } = imageSize(shot.buffer);
    return { ...shot, width, height };
}

export { capturePng, captureCompressed, runFile };

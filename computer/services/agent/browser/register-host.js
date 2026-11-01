// 把原生消息宿主登记到本机的 Chromium 系浏览器,插件才能连上电脑端。每次启动都重写,安装位置变了也能跟上。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 宿主的名字,和插件的固定 ID(由 extension/manifest.json 里的 key 决定)。插件里的 HOST 要和这里一致。 */
export const HOST = 'yun.roam.browser';
export const EXTENSION = 'opkcnndhnmkilimegkcgeecanhjebpge';

const SCRIPT = fileURLToPath(new URL('./native-host.js', import.meta.url));

/** 浏览器只能直接启动一个可执行文件,所以写一个启动脚本:用当前的 node 跑 native-host.js。 */
function writeLauncher({ dir, socket }) {
    if (process.platform === 'win32') {
        const file = path.join(dir, 'native-host.cmd');
        fs.writeFileSync(file, `@echo off\r\nset "ROAM_BROWSER_SOCKET=${socket}"\r\n"${process.execPath}" "${SCRIPT}" %*\r\n`);
        return file;
    }
    const file = path.join(dir, 'native-host.sh');
    const q = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(file, `#!/bin/sh\nexport ROAM_BROWSER_SOCKET=${q(socket)}\nexec ${q(process.execPath)} ${q(SCRIPT)} "$@"\n`);
    fs.chmodSync(file, 0o755);
    return file;
}

/** dir:放启动脚本和登记文件的目录;socket:电脑端监听的管道地址。返回登记到了哪些浏览器。 */
export function registerHost({ dir, socket }) {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return [];
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const launcher = writeLauncher({ dir, socket });
    const manifest = JSON.stringify({
        name: HOST,
        description: 'Roam 浏览器插件的原生消息宿主',
        path: launcher,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION}/`],
    }, null, 2);

    if (process.platform === 'win32') {
        // Windows 上浏览器从注册表找登记文件
        const file = path.join(dir, `${HOST}.json`);
        fs.writeFileSync(file, manifest);
        const done = [];
        for (const browser of ['Google\\Chrome', 'Microsoft\\Edge']) {
            const result = spawnSync('reg', ['add', `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${HOST}`, '/ve', '/t', 'REG_SZ', '/d', file, '/f'], { stdio: 'ignore', windowsHide: true });
            if (result.status === 0) done.push(browser);
        }
        return done;
    }

    // macOS 上每个浏览器有自己的登记目录;只给装了的浏览器写
    const support = path.join(os.homedir(), 'Library', 'Application Support');
    const done = [];
    for (const browser of ['Google/Chrome', 'Microsoft Edge', 'Chromium', 'BraveSoftware/Brave-Browser', 'Arc/User Data']) {
        const base = path.join(support, browser);
        if (!fs.existsSync(base)) continue;
        const directory = path.join(base, 'NativeMessagingHosts');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, `${HOST}.json`), manifest);
        done.push(browser);
    }
    return done;
}

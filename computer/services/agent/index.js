// 设备端执行器：模型、对话和 SQL 都在云端，这里只负责把工具调用跑在这台电脑上。
// 云端发 tool.call { call_id, name, arguments }，这里回 tool.result { call_id, result }；
// 结果里的图片（read 截图等）先落本地临时文件，转成 base64 一起带上去。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import ws from '../../ws.js';
import { paths, defaults } from './config.js';
import { imageTypes } from './images.js';
import { startBrowser } from './browser/bridge.js';
import { registerHost } from './browser/register-host.js';
import runTool from './agent/runner.js';

let context = null;

// browser=false 时不连浏览器插件（测试和纯 CLI 场景用）。
function start({ browser = true } = {}) {
    const p = paths();
    const local = defaults();
    context = {
        paths: p,
        browser: browser
            ? startBrowser({ address: p.browser, onChange: () => report() })
            : {
                request: async () => { throw new Error('浏览器插件未启用'); },
                connected: () => false,
                close() {},
            },
        // 工具执行用的本地参数：工具读写的目录、超时和输出上限都是这台电脑的事。
        toolConfig: {
            workdir: local.workdir || os.homedir(),
            timeout: Number.isSafeInteger(local.timeout) ? local.timeout : 120,
            max_output: Number.isSafeInteger(local.max_output) ? local.max_output : 30000,
            images_dir: p.images,
            run_images: null,
        },
        // 退出时用它取消所有还在跑的工具，别让 shell 卡住进程。
        controller: new AbortController(),
    };
    if (!browser) return;
    try {
        const browsers = registerHost({ dir: path.join(p.root, 'native-host'), socket: p.browser });
        if (browsers.length) console.log(`🧩 浏览器插件宿主已登记：${browsers.join('、')}`);
    } catch (error) {
        console.error('🧩 浏览器插件宿主登记失败：', error.message);
    }
}

// 连上后告诉云端这台电脑是谁、能从哪里开始干活，会话列表和系统提示都要用。
function report() {
    if (!context) return;
    ws.send({
        type: 'device.report',
        to: 'desktop',
        data: {
            id: 'desktop',
            name: `${os.userInfo().username} 的 ${os.type() === 'Darwin' ? 'Mac' : os.hostname()}`,
            platform: process.platform,
            arch: process.arch,
            host: os.hostname(),
            username: os.userInfo().username,
            workdir: context.toolConfig.workdir,
            browser: context.browser.connected(),
        },
    });
}

// 图片工具返回的是本地 /api/images/<name>，云端读不到，读成 base64 带上去。
async function attachImage(result) {
    const name = typeof result.imageURL === 'string' ? result.imageURL.split('/').pop() : '';
    const type = imageTypes[path.extname(name)];
    if (!type) return { text: result.text, failed: Boolean(result.failed) };
    const file = path.join(context.paths.images, name);
    try {
        const bytes = await fs.readFile(file);
        return {
            text: result.text,
            failed: Boolean(result.failed),
            image: { base64: bytes.toString('base64'), mime: type },
        };
    } catch (error) {
        return { text: `${result.text}\n（图片读取失败：${error.message}）`, failed: true };
    } finally {
        // 云端会存进 R2，本地这份不用留。
        await fs.rm(file, { force: true });
    }
}

// 云端带下来的运行参数和对话信息；坏值一律忽略，保住本机默认。
function pickSettings(config) {
    if (!config || typeof config !== 'object') return {};
    const next = {};
    const workdir = typeof config.workdir === 'string' ? config.workdir.trim() : '';
    if (workdir) next.workdir = workdir;
    for (const key of ['timeout', 'max_output']) {
        const value = config[key];
        if (Number.isSafeInteger(value) && value > 0) next[key] = value;
    }
    // 浏览器插件按对话把标签页放进以标题命名的标签组。
    for (const key of ['session_id', 'session_title']) {
        if (typeof config[key] === 'string') next[key] = config[key];
    }
    return next;
}

// 跑一次工具，返回可以直接塞进 tool.result 的载荷（图片转成 base64）。
async function execute({ name, arguments: args, config } = {}) {
    let result;
    try {
        result = await runTool(
            { name, arguments: JSON.stringify(args ?? {}) },
            // 云端设置覆盖本地默认值；工作目录留空就用这台电脑的用户目录。
            { ...context.toolConfig, ...pickSettings(config), browser: context.browser },
            context.controller.signal,
        );
    } catch (error) {
        result = { text: error.message, failed: true };
    }
    if (!result.imageURL) return { text: result.text, failed: Boolean(result.failed) };
    return attachImage(result);
}

async function handle(message) {
    if (message.type !== 'tool.call') return false;
    const { call_id: callId } = message.data || {};
    if (!callId) return true;
    const result = await execute(message.data);
    ws.send({ type: 'tool.result', to: 'desktop', data: { call_id: callId, result } });
    return true;
}

async function shutdown() {
    if (!context) return;
    context.controller.abort(new DOMException('已关闭', 'AbortError'));
    context.browser.close();
    context = null;
}

export { start, execute, handle, report, shutdown };
export default { start, execute, handle, report, shutdown };

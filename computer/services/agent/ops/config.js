// 设置：读（不回显密钥）和改。保存在电脑端 ~/.roam/agent/config.json。
import os from 'node:os';
import { saveConfig, validateConfig } from '../config.js';
import { fail, pick } from './util.js';

export function get(context) {
    const config = context.config;
    let keyHint = '';
    if (config.apiKey) {
        if (config.apiKey.length <= 10) {
            keyHint = '***';
        } else {
            keyHint = config.apiKey.slice(0, 6) + '...' + config.apiKey.slice(-4);
        }
    }
    return {
        responsesUrl: config.responsesUrl,
        key_set: Boolean(config.apiKey),
        key_hint: keyHint,
        model: config.model,
        context_window: config.context_window,
        system: config.system,
        compact_at: config.compact_at,
        keep: config.keep,
        compact_system: config.compact_system,
        compact_prefix: config.compact_prefix,
        workdir: config.workdir,
        run_timeout: config.run_timeout,
        timeout: config.timeout,
        max_output: config.max_output,
        paths: {
            data_dir: context.paths.root,
            config: context.paths.config,
        },
    };
}

export function put(context, args) {
    const patch = pick(args, [
        'responsesUrl', 'apiKey', 'model', 'context_window', 'system', 'compact_at', 'keep',
        'compact_system', 'compact_prefix', 'workdir', 'run_timeout', 'timeout', 'max_output',
    ]);
    const next = { ...context.config };

    for (const [key, value] of Object.entries(patch)) {
        switch (key) {
            case 'responsesUrl':
            case 'apiKey':
            case 'model':
            case 'workdir': {
                if (typeof value !== 'string') {
                    fail(400, `${key} 必须是字符串`);
                }
                // 设置页不回显密钥，留空表示保留已保存的密钥。
                if (key === 'apiKey' && value.trim() === '') {
                    break;
                }
                next[key] = value.trim();
                break;
            }
            default:
                next[key] = value;
        }
    }

    try {
        validateConfig(next);
    } catch (error) {
        fail(400, error.message);
    }
    saveConfig(context.paths, next);
    context.config = next;
    return { saved: true };
}

export function status(context) {
    const config = context.config;
    return {
        model: config.model,
        model_ready: Boolean(config.responsesUrl && config.apiKey && config.model),
        workdir: config.workdir || os.homedir(),
        browser_connected: Boolean(context.browser?.connected()),
    };
}

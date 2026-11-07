// 渲染与文案：markdown 净化、工具行的标签、时间标签。移植自 agentic 的 format.tsx。
import { marked } from 'marked';

// 净化渲染：正文来自模型和工具输出，属不可信内容，却要经 v-html 落进页面。
// 在 marked 层掐断 XSS：丢弃原始 HTML，中和 javascript:/data: 链接。
function isUnsafeUrl(url) {
    return /^\s*(javascript|data|vbscript):/i.test(url);
}

class SafeRenderer extends marked.Renderer {
    html() {
        return '';
    }

    link(token) {
        if (isUnsafeUrl(token.href)) {
            return super.link({ ...token, href: '#' });
        }
        return super.link(token).replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
    }

    image(token) {
        if (isUnsafeUrl(token.href)) {
            return super.image({ ...token, href: '' });
        }
        return super.image(token);
    }
}

marked.setOptions({ breaks: true, gfm: true, renderer: new SafeRenderer() });

export const renderMd = (value) => marked.parse(String(value || ''), { async: false });

/* ── 工具行的图标与文案 ── */

const basename = (value) => String(value ?? '').split('/').filter(Boolean).pop() || '';

const oneLine = (value, max = 120) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
};

// icon 对应 StepIcon 里的图形名
export function toolMeta(row) {
    const args = row.args || {};
    switch (row.name) {
        case 'read':
            return { icon: 'doc', label: '读取', pill: basename(args.path) };
        case 'write':
            return { icon: 'pen', label: '写入', pill: basename(args.path) };
        case 'edit':
            return { icon: 'pen', label: '修改', pill: basename(args.path) };
        case 'shell':
            return { icon: 'terminal', label: '执行', pill: oneLine(args.command) };
        case 'browser':
            return { icon: 'globe', label: '浏览器', pill: oneLine(args.method || args.url || args.action) };
        case 'computer':
            return { icon: 'desktop', label: { screenshot: '查看屏幕', click: '点击', scroll: '滚动', type: '输入文字', key: '按键' }[args.action] || '操作桌面', pill: args.action === 'key' ? oneLine(args.key) : '' };
        default:
            return { icon: 'terminal', label: row.name || 'tool', pill: '' };
    }
}

export function isFailed(row) {
    return row.failed === true;
}

export function fmtArgs(args) {
    return JSON.stringify(args || {}, null, 2);
}

/** 「输出」：常是压成一行的 JSON，能解析就缩进，否则原样。 */
export function fmtResult(value) {
    if (value == null || value === '') return '';
    const text = String(value);
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

/* ── 时间 ── */

/** 消息流里的「今天 / 昨天 / M月D日」分隔标签。 */
export function dayLabel(at) {
    if (!at) return '';
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return '';
    const startOf = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const diff = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** ≥60s 显示 "N 分 M 秒"，<60s 显示 "N 秒"；最小 1 秒。 */
export function formatDuration(ms) {
    const total = Math.max(1, Math.round(ms / 1000));
    if (total < 60) return `${total} 秒`;
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

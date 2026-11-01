import { marked } from 'marked';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const SAFE_HREF = /^(https?:|mailto:|#)/i;

// 模型输出经 v-html 渲染：原始 HTML 一律转义，链接只放行 http(s)/mailto，
// 防止模型（或它读到的网页内容）往这个能操控电脑的页面里注入脚本。
marked.use({
    breaks: true,
    gfm: true,
    renderer: {
        html({ text }) {
            return escapeHtml(text);
        },
        link({ href, title, tokens }) {
            const text = this.parser.parseInline(tokens);
            if (!SAFE_HREF.test(String(href || '').trim())) return text;
            const t = title ? ` title="${escapeHtml(title)}"` : '';
            return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
        },
        image({ href, text }) {
            return escapeHtml(text || href || '');
        },
    },
});

const TOOL_LABELS = {
    shell: '终端命令',
    browser_cdp: '浏览器',
    open_app: '打开应用',
    computer_status: '电脑状态',
    computer_screenshot: '屏幕截图',
    computer_type: '键盘输入',
    computer_key: '按键',
    computer_click: '鼠标点击',
    computer_move: '移动鼠标',
    computer_scroll: '滚动',
};

function toolLabel(name) {
    return TOOL_LABELS[name] || name;
}

function toolSubtitle(row) {
    const args = row.args || {};
    return args.summary || args.command || args.method || args.text || args.name || args.key || '';
}

function renderMd(value) {
    return marked.parse(String(value || ''));
}

function fmtArgs(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function fmtTime(value) {
    if (!value) return '';
    const date = new Date(value);
    const diff = Date.now() - value;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

export { fmtArgs, fmtTime, renderMd, toolLabel, toolSubtitle };

import { chromium } from 'playwright';
import { BROWSER_CHANNEL } from '../../../core/env.js';

const state = {
    browser: null,
    context: null,
    page: null,
};

function serialize(value) {
    if (value === undefined) return null;
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return String(value); }
}

function parseUserFunction(code) {
    const source = String(code || '').trim();
    if (!source) throw new Error('缺少 code');
    const wrapped = source.startsWith('async ') || source.startsWith('(') || source.startsWith('function')
        ? source
        : `async (page, context, browser) => { ${source} }`;
    try {
        return new Function(`return (${wrapped});`)();
    } catch (error) {
        throw new Error(`Playwright 代码解析失败: ${error.message}`);
    }
}

async function ensurePage() {
    if (!state.browser || !state.browser.isConnected()) {
        state.browser = await chromium.launch({ headless: false, channel: BROWSER_CHANNEL });
    }
    if (!state.context) {
        state.context = await state.browser.newContext();
    }
    if (!state.page || state.page.isClosed()) {
        state.page = state.context.pages()[0] || await state.context.newPage();
    }
    return state.page;
}

export default async function run({ code } = {}) {
    const fn = parseUserFunction(code);
    const page = await ensurePage();
    const result = await fn(page, state.context, state.browser);
    return serialize(result);
};

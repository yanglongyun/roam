<script setup>
// 助理设置，存在云端 D1（API Key 加密保存）；工具由电脑端执行。
import { computed, reactive, ref, watch } from 'vue';
import { useAgentStore } from '@/stores/agent';
import { useWsStore } from '@/stores/ws';
import { useToastStore } from '@/stores/toast';

const agent = useAgentStore();
const ws = useWsStore();
const toast = useToastStore();

const NUMBER_FIELDS = ['context_window', 'compact_at', 'keep', 'run_timeout', 'timeout', 'max_output'];
const TEXT_FIELDS = ['responsesUrl', 'model', 'system', 'compact_system', 'compact_prefix', 'workdir'];

const config = ref(null);
const form = reactive({ apiKey: '' });
const saving = ref(false);
const saved = ref(false);
const loadError = ref('');

function fill(value) {
    config.value = value;
    for (const key of TEXT_FIELDS) form[key] = value[key] ?? '';
    for (const key of NUMBER_FIELDS) form[key] = String(value[key] ?? '');
    form.apiKey = '';
}

async function load() {
    if (!ws.showActions) return;
    loadError.value = '';
    void agent.loadStatus();
    try {
        fill(await agent.getConfig());
    } catch (error) {
        loadError.value = error.message || '设置加载失败';
    }
}

const dirty = computed(() => {
    if (!config.value) return false;
    if (form.apiKey.trim()) return true;
    return TEXT_FIELDS.some((key) => form[key] !== (config.value[key] ?? ''))
        || NUMBER_FIELDS.some((key) => form[key] !== String(config.value[key] ?? ''));
});

async function save() {
    if (!ws.showActions || saving.value || !dirty.value) return;
    const patch = {};
    for (const key of TEXT_FIELDS) patch[key] = form[key];
    for (const key of NUMBER_FIELDS) {
        const value = Number(form[key]);
        const minimum = key === 'context_window' ? 0 : 1;
        if (!/^\d+$/.test(String(form[key]).trim()) || !Number.isSafeInteger(value) || value < minimum) {
            toast.show(`${LABELS[key]}必须是大于等于 ${minimum} 的整数`, 2400);
            return;
        }
        patch[key] = value;
    }
    if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim();
    saving.value = true;
    try {
        await agent.saveConfig(patch);
        fill(await agent.getConfig());
        saved.value = true;
        setTimeout(() => { saved.value = false; }, 1800);
    } catch (error) {
        toast.show(error.message || '保存失败', 2400);
    } finally {
        saving.value = false;
    }
}

const LABELS = {
    context_window: '模型上下文窗口',
    compact_at: '压缩阈值',
    keep: '压缩后保留条数',
    run_timeout: '回复超时',
    timeout: '命令超时',
    max_output: '工具输出上限',
};

watch(() => ws.showActions, (online) => { if (online) load(); }, { immediate: true });
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col bg-zinc-950">
        <main class="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <div class="mx-auto w-full max-w-2xl space-y-4">
                <div v-if="!ws.showActions" class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
                    未连接云端，无法读写助理设置。
                </div>
                <div v-else-if="loadError" class="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
                    {{ loadError }}
                </div>

                <template v-if="config">
                    <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">模型</h3>
                        <div class="space-y-3">
                            <label class="block">
                                <span class="field-k">接口地址（Responses）</span>
                                <input class="field" v-model="form.responsesUrl" placeholder="https://api.openai.com/v1/responses" spellcheck="false" autocapitalize="off" />
                            </label>
                            <label class="block">
                                <span class="field-k">API Key</span>
                                <input class="field" v-model="form.apiKey" type="password" autocomplete="off" spellcheck="false"
                                    :placeholder="config.key_set ? `已设置（${config.key_hint}），留空保持不变` : '未设置'" />
                            </label>
                            <label class="block">
                                <span class="field-k">模型</span>
                                <input class="field" v-model="form.model" placeholder="模型 ID" spellcheck="false" autocapitalize="off" />
                            </label>
                            <label class="block">
                                <span class="field-k">模型上下文窗口（tokens）</span>
                                <input class="field" v-model="form.context_window" inputmode="numeric" />
                                <span class="field-note">0 表示不限制；填了的话，压缩阈值必须小于它。</span>
                            </label>
                            <label class="block">
                                <span class="field-k">系统提示词</span>
                                <textarea class="field" v-model="form.system" rows="6" spellcheck="false"></textarea>
                                <span class="field-note" v-pre>支持变量 {{os}} {{arch}} {{host}} {{user}} {{workdir}} {{time}} {{device_status}}，环境信息来自电脑端上次连接时的登记。</span>
                            </label>
                        </div>
                    </section>

                    <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">上下文压缩</h3>
                        <div class="grid grid-cols-2 gap-3">
                            <label class="block">
                                <span class="field-k">压缩阈值（tokens）</span>
                                <input class="field" v-model="form.compact_at" inputmode="numeric" />
                            </label>
                            <label class="block">
                                <span class="field-k">压缩后保留条数</span>
                                <input class="field" v-model="form.keep" inputmode="numeric" />
                            </label>
                        </div>
                        <p class="field-note">上次回复用掉的 token 达到阈值时，把较早的消息写成交接摘要，保留最近的若干条不动。</p>
                        <label class="mt-3 block">
                            <span class="field-k">压缩提示词</span>
                            <textarea class="field" v-model="form.compact_system" rows="3" spellcheck="false"></textarea>
                        </label>
                        <label class="mt-3 block">
                            <span class="field-k">摘要前缀</span>
                            <textarea class="field" v-model="form.compact_prefix" rows="2" spellcheck="false"></textarea>
                        </label>
                    </section>

                    <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">运行</h3>
                        <label class="block">
                            <span class="field-k">工作目录</span>
                            <input class="field" v-model="form.workdir" placeholder="留空使用用户目录" spellcheck="false" autocapitalize="off" />
                            <span class="field-note">工具里的相对路径以这里为准，必须是电脑上已存在的绝对路径。</span>
                        </label>
                        <div class="mt-3 grid grid-cols-3 gap-3">
                            <label class="block">
                                <span class="field-k">回复超时（秒）</span>
                                <input class="field" v-model="form.run_timeout" inputmode="numeric" />
                            </label>
                            <label class="block">
                                <span class="field-k">命令超时（秒）</span>
                                <input class="field" v-model="form.timeout" inputmode="numeric" />
                            </label>
                            <label class="block">
                                <span class="field-k">工具输出上限（字符）</span>
                                <input class="field" v-model="form.max_output" inputmode="numeric" />
                            </label>
                        </div>
                    </section>

                    <div class="flex items-center gap-2">
                        <button @click="save" :disabled="!dirty || saving"
                            class="h-9 rounded bg-emerald-600 px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                            {{ saved ? '已保存 ✓' : (saving ? '保存中…' : '保存') }}
                        </button>
                        <button @click="fill(config)" :disabled="!dirty || saving"
                            class="h-9 rounded border border-zinc-700 bg-zinc-800 px-4 text-sm text-zinc-100 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50">
                            重置
                        </button>
                    </div>

                    <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">电脑端</h3>
                        <div class="text-sm">
                            <span class="text-zinc-500">状态：</span>
                            <span :class="agent.status?.device_online ? 'text-emerald-400' : 'text-zinc-400'">
                                {{ agent.status?.device_online ? '已连接' : '未连接，工具暂不可用' }}
                            </span>
                        </div>
                        <div v-if="agent.status?.device" class="mt-2 text-xs leading-relaxed text-zinc-500">
                            <div class="truncate">{{ agent.status.device.name || agent.status.device.host }}</div>
                            <div class="truncate font-mono">{{ agent.status.device.workdir }}</div>
                        </div>
                    </section>

                    <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">浏览器插件</h3>
                        <p class="text-xs leading-relaxed text-zinc-500">
                            在 Chrome / Edge 打开扩展程序页，开启开发者模式，「加载已解压的扩展程序」选仓库里的 <code class="font-mono">extension/</code>。
                            插件会经原生消息自动连上电脑端，不用填地址；要让助理打开本机文件，在插件「详情」里打开「允许访问文件网址」。
                        </p>
                        <div class="mt-2 text-sm">
                            <span class="text-zinc-500">状态：</span>
                            <span :class="agent.status?.browser_connected ? 'text-emerald-400' : 'text-zinc-400'">
                                {{ agent.status?.browser_connected ? '已连接' : '未连接' }}
                            </span>
                        </div>
                    </section>

                </template>

                <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">关于</h3>
                    <p class="text-xs leading-relaxed text-zinc-500">本项目把本机终端 / 文件 / 屏幕带到任意浏览器；AI 助理的会话、消息和配置存在云端 D1 / R2，工具调用转发到你的电脑执行。</p>
                    <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                        <dt class="text-zinc-500">连接</dt>
                        <dd class="truncate text-right text-zinc-100">{{ ws.statusText }}</dd>
                        <dt class="text-zinc-500">项目</dt>
                        <dd class="truncate text-right">
                            <a href="https://github.com/yanglongyun/roam" target="_blank" rel="noopener"
                                class="text-emerald-400 hover:text-emerald-300">github.com/yanglongyun/roam</a>
                        </dd>
                    </dl>
                </section>
            </div>
        </main>
    </div>
</template>

<style scoped>
.field-k {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--color-muted);
}
.field-note {
    display: block;
    margin-top: 6px;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--color-faint);
}
.field {
    display: block;
    width: 100%;
    border-radius: 6px;
    border: 1px solid var(--color-line-hi);
    background: var(--color-bg);
    padding: 8px 10px;
    color: var(--color-ink);
    outline: none;
    resize: vertical;
    transition: border-color 0.15s ease;
}
.field:focus { border-color: var(--color-accent); }
.field::placeholder { color: var(--color-faint); }
</style>

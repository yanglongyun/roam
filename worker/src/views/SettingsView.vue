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

/* ── 设备：名字和描述存云端，助理的系统提示里会列出来 ── */
const deviceForms = reactive({});   // id -> { name, description }
const deviceSaving = ref('');

function deviceForm(device) {
    if (!deviceForms[device.id]) {
        deviceForms[device.id] = { name: device.name || '', description: device.description || '' };
    }
    return deviceForms[device.id];
}
function deviceDirty(device) {
    const f = deviceForm(device);
    return f.name !== (device.name || '') || f.description !== (device.description || '');
}
async function saveDevice(device) {
    const f = deviceForm(device);
    deviceSaving.value = device.id;
    try {
        await agent.patchDevice({ id: device.id, name: f.name.trim(), description: f.description.trim() });
        toast.show('设备已保存', 1800);
    } catch (error) {
        toast.show(error.message || '保存失败', 2400);
    } finally {
        deviceSaving.value = '';
    }
}
async function removeDevice(device) {
    if (!window.confirm(`删除「${ws.deviceLabel(device)}」的登记？下次连上会重新登记。`)) return;
    try {
        await agent.removeDevice(device.id);
        delete deviceForms[device.id];
        toast.show('已删除登记', 1800);
    } catch (error) {
        toast.show(error.message || '删除失败', 2400);
    }
}
function lastSeen(device) {
    if (device.online) return '在线';
    if (!device.last_seen) return '从未上线';
    return `最后在线 ${new Date(device.last_seen).toLocaleString()}`;
}

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
                                <span class="field-note" v-pre>支持变量 {{devices}}（全部设备清单，含 id、名字、描述、在线状态）、{{time}}、{{device_status}}。删掉 {{devices}} 助理就不知道有哪些设备。</span>
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
                            <input class="field" v-model="form.workdir" placeholder="留空使用各设备的用户目录" spellcheck="false" autocapitalize="off" />
                            <span class="field-note">工具里的相对路径以这里为准，对所有设备生效；留空则每台设备用自己的用户目录。</span>
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
                        <h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">设备</h3>
                        <p class="field-note !mt-0 mb-3">每台跑着 Roam Computer 的电脑在这里登记。名字和描述会出现在助理的系统提示里，写清楚这台机器是干什么的，助理才知道该把任务派给谁。</p>
                        <div v-if="!ws.devices.length" class="text-sm text-zinc-500">还没有设备接入过。在电脑上运行 <code class="font-mono">npm start</code> 即可。</div>
                        <div v-for="device in ws.devices" :key="device.id" class="mb-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 last:mb-0">
                            <div class="mb-2 flex items-center gap-2 text-xs">
                                <span class="h-2 w-2 shrink-0 rounded-full" :class="device.online ? 'bg-emerald-500' : 'bg-zinc-600'"></span>
                                <span :class="device.online ? 'text-emerald-400' : 'text-zinc-500'">{{ lastSeen(device) }}</span>
                                <span class="text-zinc-600">·</span>
                                <span class="text-zinc-500">浏览器插件{{ device.browser ? '已连接' : '未连接' }}</span>
                                <span class="ml-auto truncate font-mono text-zinc-600">{{ device.id }}</span>
                            </div>
                            <div class="space-y-2">
                                <label class="block">
                                    <span class="field-k">名字</span>
                                    <input class="field" v-model="deviceForm(device).name" :placeholder="device.host || '设备名字'" spellcheck="false" />
                                </label>
                                <label class="block">
                                    <span class="field-k">描述</span>
                                    <textarea class="field" v-model="deviceForm(device).description" rows="2" spellcheck="false"
                                        placeholder="这台机器干什么用、装了什么环境、常用目录在哪……"></textarea>
                                </label>
                            </div>
                            <div class="mt-2 text-[11.5px] leading-relaxed text-zinc-500">
                                <span>{{ [device.platform, device.arch].filter(Boolean).join('/') || '未知系统' }}</span>
                                <span v-if="device.host"> · {{ device.host }}</span>
                                <span v-if="device.username"> · {{ device.username }}</span>
                                <div v-if="device.workdir" class="truncate font-mono">{{ device.workdir }}</div>
                            </div>
                            <div class="mt-2 flex items-center gap-2">
                                <button @click="saveDevice(device)" :disabled="!deviceDirty(device) || deviceSaving === device.id"
                                    class="h-8 rounded bg-emerald-600 px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                                    {{ deviceSaving === device.id ? '保存中…' : '保存' }}
                                </button>
                                <button v-if="!device.online" @click="removeDevice(device)"
                                    class="h-8 rounded border border-zinc-700 bg-zinc-800 px-3 text-xs text-rose-300 transition-colors hover:bg-zinc-700">
                                    删除登记
                                </button>
                            </div>
                        </div>
                    </section>

                    <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">浏览器插件</h3>
                        <p class="text-xs leading-relaxed text-zinc-500">
                            在每台要让助理操作浏览器的电脑上：Chrome / Edge 打开扩展程序页，开启开发者模式，「加载已解压的扩展程序」选仓库里的 <code class="font-mono">extension/</code>。
                            插件会经原生消息自动连上本机的电脑端，不用填地址；要让助理打开本机文件，在插件「详情」里打开「允许访问文件网址」。连接状态见上面各设备的标注。
                        </p>
                    </section>

                </template>

                <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">关于</h3>
                    <p class="text-xs leading-relaxed text-zinc-500">本项目把多台电脑的终端 / 文件 / 屏幕带到任意浏览器；AI 助理的会话、消息和配置存在云端 D1 / R2，工具调用按会话或参数指定的设备转发执行。</p>
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

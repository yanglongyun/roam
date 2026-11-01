<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useModelStore } from '@/stores/model';
import { useWsStore } from '@/stores/ws';

const model = useModelStore();
const ws = useWsStore();

const form = reactive({ baseUrl: '', apiKey: '', model: '', system: '', compressThreshold: '12000', toolResultMaxChars: '12000', compactPrompt: '' });
const saved = ref(false);
const saving = ref(false);

// 电脑端只回掩码，不回明文 key
const keyMasked = computed(() => model.config.keyPreview || (model.config.hasKey ? '已设置' : '未设置'));

const dirty = computed(() =>
    form.baseUrl !== (model.config.baseUrl || '') ||
    form.model !== (model.config.model || '') ||
    form.system !== (model.config.system || '') ||
    form.apiKey.trim().length > 0 ||
    String(form.compressThreshold) !== String(model.config.compressThreshold ?? 12000) ||
    String(form.toolResultMaxChars) !== String(model.config.toolResultMaxChars ?? 12000) ||
    form.compactPrompt !== (model.config.compactPrompt || '')
);

function syncFromServer() {
    const c = model.config;
    form.baseUrl = c.baseUrl || '';
    form.model = c.model || '';
    form.system = c.system || '';
    form.apiKey = ''; // 不回填明文，留空＝不改
    form.compressThreshold = String(c.compressThreshold ?? 12000);
    form.toolResultMaxChars = String(c.toolResultMaxChars ?? 12000);
    form.compactPrompt = c.compactPrompt || '';
}

async function load() {
    if (!ws.showActions) return;
    await model.load();
    syncFromServer();
}

async function save() {
    if (!ws.showActions || saving.value || !dirty.value) return;
    saving.value = true;
    const patch = {
        baseUrl: String(form.baseUrl).trim(),
        model: String(form.model).trim(),
        system: String(form.system),
        compressThreshold: String(Number(form.compressThreshold) || 12000),
        toolResultMaxChars: String(Number(form.toolResultMaxChars) || 12000),
        compactPrompt: String(form.compactPrompt),
    };
    if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim();
    await model.save(patch);
    syncFromServer();
    saving.value = false;
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 1800);
}

onMounted(load);
watch(() => ws.showActions, (v) => { if (v) load(); });
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col bg-zinc-950">
        <main class="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <div class="mx-auto w-full max-w-2xl space-y-4">
                <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">模型</h3>
                    <div class="space-y-3">
                        <label class="block">
                            <span class="field-k">API 地址</span>
                            <input class="field" v-model="form.baseUrl" :disabled="!ws.showActions" placeholder="https://api.openai.com/v1" spellcheck="false" autocapitalize="off" />
                        </label>
                        <label class="block">
                            <span class="field-k">API Key</span>
                            <input class="field" v-model="form.apiKey" type="password" :disabled="!ws.showActions" :placeholder="keyMasked" autocomplete="off" spellcheck="false" />
                        </label>
                        <label class="block">
                            <span class="field-k">模型</span>
                            <input class="field" v-model="form.model" :disabled="!ws.showActions" placeholder="gpt-4o" spellcheck="false" autocapitalize="off" />
                        </label>
                        <label class="block">
                            <span class="field-k">附加系统提示词</span>
                            <textarea class="field" v-model="form.system" :disabled="!ws.showActions" rows="3" placeholder="可选，追加在内置提示词之后" spellcheck="false"></textarea>
                        </label>
                    </div>
                    <p class="mt-3 text-xs leading-relaxed text-zinc-500">
                        <template v-if="ws.showActions">
                            填任意 OpenAI 兼容的 chat/completions 接口。配置保存在电脑端 <code class="font-mono">~/.roam/roam.db</code>，不经过 Worker。当前 Key：{{ keyMasked }}，留空表示不修改。
                        </template>
                        <template v-else>未连接电脑端，无法读写模型配置。</template>
                    </p>
                </section>

                <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">对话压缩</h3>
                    <div class="grid grid-cols-2 gap-3">
                        <label class="block">
                            <span class="field-k">压缩阈值（tokens）</span>
                            <input class="field" v-model="form.compressThreshold" type="number" inputmode="numeric" :disabled="!ws.showActions" placeholder="12000" />
                        </label>
                        <label class="block">
                            <span class="field-k">工具结果上限（字符）</span>
                            <input class="field" v-model="form.toolResultMaxChars" type="number" inputmode="numeric" :disabled="!ws.showActions" placeholder="12000" />
                        </label>
                    </div>
                    <label class="mt-3 block">
                        <span class="field-k">压缩提示词</span>
                        <textarea class="field" v-model="form.compactPrompt" :disabled="!ws.showActions" rows="4" placeholder="留空则使用内置的默认压缩提示词" spellcheck="false"></textarea>
                    </label>
                    <p class="mt-3 text-xs leading-relaxed text-zinc-500">
                        上下文累计 token 超过阈值时，会先用模型把较早的消息总结成一条摘要，之后只带摘要继续对话。工具返回内容超过上限的部分会被截断。
                    </p>
                </section>

                <div class="flex items-center gap-2">
                    <button @click="save" :disabled="!ws.showActions || !dirty || saving"
                        class="h-9 rounded bg-emerald-600 px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                        {{ saved ? '已保存 ✓' : (saving ? '保存中…' : '保存') }}
                    </button>
                    <button @click="syncFromServer" :disabled="!dirty || saving"
                        class="h-9 rounded border border-zinc-700 bg-zinc-800 px-4 text-sm text-zinc-100 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50">
                        重置
                    </button>
                </div>
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
.field:disabled { opacity: 0.6; }
.field::placeholder { color: var(--color-faint); }
</style>

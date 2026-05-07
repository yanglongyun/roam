<script setup>
import { computed, reactive, watch } from 'vue';
import { useAgentStore } from '@/stores/agent';

const agent = useAgentStore();

const form = reactive({
    provider: agent.provider || 'openai',
    apiUrl: agent.apiUrl || '',
    apiKey: '',
    model: agent.model || '',
});

const groups = computed(() => agent.providerGroups || []);
const providers = computed(() => agent.providers || []);
const selectedProvider = computed(() => agent.getProvider(form.provider));
const isCustom = computed(() => form.provider === 'custom');

function providersInGroup(groupId) {
    return providers.value.filter((item) => item.group === groupId);
}

function groupLabel(groupId) {
    return groups.value.find((group) => group.id === groupId)?.name || groupId;
}

watch(() => form.provider, (id) => {
    const current = agent.getProvider(id);
    if (current && id !== 'custom') {
        form.apiUrl = current.apiUrl || '';
        form.model = current.defaultModel || '';
    }
});

watch(
    () => [agent.provider, agent.apiUrl, agent.model],
    ([provider, apiUrl, model]) => {
        if (!form.provider && provider) form.provider = provider;
        if (!form.apiUrl && apiUrl) form.apiUrl = apiUrl;
        if (!form.model && model) form.model = model;
    }
);

watch(
    () => providers.value.length,
    (count) => {
        if (!count) return;
        if (agent.getProvider(form.provider)) return;
        form.provider = providers.value[0]?.id || 'custom';
    },
    { immediate: true }
);

const emit = defineEmits(['saved']);

function save() {
    agent.saveConfig({
        provider: form.provider,
        apiUrl: form.apiUrl,
        apiKey: form.apiKey,
        model: form.model,
    });
    form.apiKey = '';
    emit('saved');
}

defineExpose({ save });
</script>

<template>
    <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
            <label class="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted">Provider</label>
            <select
                v-model="form.provider"
                class="h-11 w-full rounded-[10px] border border-line bg-bg px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent">
                <optgroup
                    v-for="group in groups"
                    :key="group.id"
                    :label="group.name">
                    <option
                        v-for="item in providersInGroup(group.id)"
                        :key="item.id"
                        :value="item.id">
                        {{ item.name }}
                    </option>
                </optgroup>
            </select>
            <div v-if="selectedProvider" class="flex min-w-0 items-center justify-between gap-3 text-[11px] text-faint">
                <span class="truncate">{{ groupLabel(selectedProvider.group) }}</span>
                <span v-if="selectedProvider.defaultModel" class="truncate font-mono">{{ selectedProvider.defaultModel }}</span>
            </div>
        </div>

        <div class="flex flex-col gap-2">
            <label class="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted">API URL</label>
            <input
                v-model="form.apiUrl"
                type="text"
                :placeholder="selectedProvider?.apiUrl || 'https://...'"
                :disabled="!isCustom && Boolean(selectedProvider?.apiUrl)"
                class="h-11 w-full rounded-[10px] border border-line bg-bg px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent disabled:opacity-50"
            />
        </div>

        <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
                <label class="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted">API Key</label>
                <a
                    v-if="selectedProvider?.keyUrl"
                    :href="selectedProvider.keyUrl"
                    target="_blank"
                    rel="noopener"
                    class="text-[10px] text-accent hover:underline"
                >
                    获取 Key
                </a>
            </div>
            <input
                v-model="form.apiKey"
                type="password"
                :placeholder="agent.apiKeyMasked || 'sk-...'"
                class="h-11 w-full rounded-[10px] border border-line bg-bg px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent"
            />
            <div class="text-[11px] text-faint">留空则沿用当前配置中的 Key。</div>
        </div>

        <div class="flex flex-col gap-2">
            <label class="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted">Model</label>
            <input
                v-model="form.model"
                type="text"
                :placeholder="selectedProvider?.defaultModel || 'model-name'"
                class="h-11 w-full rounded-[10px] border border-line bg-bg px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent"
            />
        </div>

        <button
            type="button"
            class="h-11 rounded-[10px] bg-accent text-bg text-[13px] font-semibold hover:opacity-90 transition-opacity"
            @click="save"
        >
            保存模型配置
        </button>
    </div>
</template>

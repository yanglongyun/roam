<script setup>
// 相邻已完成工具 ≥2 收成一行摘要：文件类按去重后的路径数计，执行类按次数计。
import { computed } from 'vue';
import { useConversation } from '@/lib/agent/conversation';
import { isFailed, toolMeta } from '@/lib/agent/format';
import Icon from './Icon.vue';
import ToolItem from './ToolItem.vue';

const props = defineProps({
    rows: { type: Array, required: true },
});

const agent = useConversation();
const key = computed(() => `group:${props.rows[0].key}`);
const open = computed(() => agent.expanded[key.value] === true);
const toggle = () => { agent.expanded[key.value] = !open.value; };

function groupKind(row) {
    if (row.name === 'read') return 'read';
    if (row.name === 'write') return 'create';
    if (row.name === 'edit') return 'edit';
    if (row.name === 'computer') return 'desktop';
    return 'exec';
}
function groupCount(rows, kind) {
    if (kind === 'exec' || kind === 'desktop') return rows.length;
    const paths = new Set();
    for (const row of rows) paths.add(String(row.args?.path ?? '').trim() || row.callId || '');
    return paths.size;
}
const TEXT = {
    create: (n) => `写入了 ${n} 个文件`,
    edit: (n) => `修改了 ${n} 个文件`,
    read: (n) => `读取了 ${n} 个文件`,
    exec: (n) => `执行了 ${n} 条命令`,
    desktop: (n) => `进行了 ${n} 次桌面操作`,
};
const summary = computed(() => {
    const parts = [];
    for (const kind of ['create', 'edit', 'read', 'desktop', 'exec']) {
        const matching = props.rows.filter((row) => groupKind(row) === kind);
        if (matching.length) parts.push(TEXT[kind](groupCount(matching, kind)));
    }
    return parts.join('，');
});
// 分组头部图标：取代表（edit > create > read > exec）
const icon = computed(() => {
    const pick = ['edit', 'create', 'read'].map((kind) => props.rows.find((row) => groupKind(row) === kind)).find(Boolean) || props.rows[0];
    return toolMeta(pick).icon;
});
const faded = computed(() => props.rows.every(isFailed));
</script>

<template>
    <div class="step" :class="{ open, faded }">
        <button class="step-head" @click="toggle">
            <span class="step-ic">
                <span class="step-glyph"><Icon :name="icon" :size="15" /></span>
                <span class="step-chev"><Icon name="chev" :size="12" /></span>
            </span>
            <span class="step-label"><i>{{ summary }}</i></span>
        </button>
        <div v-if="open" class="step-group">
            <ToolItem v-for="row in rows" :key="row.key" :row="row" compact />
        </div>
    </div>
</template>

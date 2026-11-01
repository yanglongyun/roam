<script setup>
// 有序渲染一串条目：过程做相邻分组（运行中的工具单独显示），中间文本按 markdown 平铺。
// inFold 时条目裸排（折叠条内部自带间距）；否则每条包一层消息行。
import { computed } from 'vue';
import { renderMd } from '@/lib/agent/format';
import ThinkItem from './ThinkItem.vue';
import ToolItem from './ToolItem.vue';
import ToolGroup from './ToolGroup.vue';

const props = defineProps({
    items: { type: Array, required: true },
    inFold: { type: Boolean, default: false },
});

const nodes = computed(() => {
    const out = [];
    let pendingTools = [];
    const flushTools = () => {
        if (!pendingTools.length) return;
        const rows = pendingTools;
        pendingTools = [];
        if (rows.length >= 2) out.push({ kind: 'group', key: `g:${rows[0].key}`, rows });
        else out.push({ kind: 'tool', key: rows[0].key, row: rows[0] });
    };
    for (const item of props.items) {
        if (item.kind === 'tool') {
            if (item.row.status === 'running') {
                flushTools();
                out.push({ kind: 'tool', key: item.row.key, row: item.row });
            } else {
                pendingTools.push(item.row);
            }
            continue;
        }
        flushTools();
        if (item.kind === 'think') out.push({ kind: 'think', key: `t:${item.row.key}`, row: item.row });
        else out.push({ kind: 'text', key: `x:${item.row.key}`, row: item.row });
    }
    flushTools();
    return out;
});
</script>

<template>
    <template v-for="node in nodes" :key="node.key">
        <div :class="inFold ? 'contents' : 'msg agent'">
            <ToolGroup v-if="node.kind === 'group'" :rows="node.rows" />
            <ToolItem v-else-if="node.kind === 'tool'" :row="node.row" />
            <ThinkItem v-else-if="node.kind === 'think'" :row="node.row" />
            <div v-else class="md" v-html="renderMd(node.row.content)"></div>
        </div>
    </template>
</template>

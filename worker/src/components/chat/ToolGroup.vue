<script setup>
import { fmtArgs, toolLabel, toolSubtitle } from '@/lib/chat/format';

defineProps({
    items: { type: Array, required: true },
});
</script>

<template>
    <div class="tool-group">
        <div
            v-for="item in items"
            :key="item._key"
            class="tool-item"
        >
            <div class="tool-head" @click="item.expanded = !item.expanded">
                <span class="tool-caret">{{ item.expanded ? '▾' : '▸' }}</span>
                <span class="tool-title">
                    {{ toolLabel(item.name) }}
                    <span v-if="toolSubtitle(item)" class="tool-sub"> · {{ toolSubtitle(item) }}</span>
                </span>
                <span class="pill" :class="item.status === 'running' ? 'run' : 'done'">
                    {{ item.status === 'running' ? '执行中' : '完成' }}
                </span>
            </div>
            <div v-if="item.expanded" class="tool-body">
                <div class="tool-k">参数</div>
                <div>{{ fmtArgs(item.args) }}</div>
                <template v-if="item.result">
                    <div class="tool-k mt-3">结果</div>
                    <div class="text-zinc-300">{{ item.result }}</div>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
.tool-group {
    width: min(100%, 680px);
    min-width: 0;
    border: 1px solid var(--color-line);
    background: var(--color-bg-elev);
    border-radius: 10px;
    overflow: hidden;
}
.tool-item + .tool-item { border-top: 1px solid var(--color-line); }
.tool-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    user-select: none;
    font-size: 12.5px;
}
.tool-head:hover { background: var(--color-bg-hi); }
.tool-caret { color: var(--color-faint); font-size: 9px; width: 10px; flex-shrink: 0; }
.tool-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-ink);
    font-weight: 600;
}
.tool-sub { color: var(--color-muted); font-weight: 400; }
.pill {
    flex-shrink: 0;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
}
.pill.done {
    background: color-mix(in srgb, var(--color-good) 16%, transparent);
    color: var(--color-good);
}
.pill.run {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    color: var(--color-accent);
    animation: pulse-dot 1.4s ease-in-out infinite;
}
.tool-body {
    max-height: 320px;
    overflow: auto;
    border-top: 1px solid var(--color-line);
    background: var(--color-bg);
    padding: 10px 12px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.65;
    color: var(--color-muted);
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
}
.tool-k {
    margin-bottom: 2px;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--color-faint);
}
</style>

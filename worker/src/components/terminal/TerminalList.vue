<script setup>
import { useTerminalStore } from '@/stores/terminal';
import { useWsStore } from '@/stores/ws';

const term = useTerminalStore();
const ws = useWsStore();
const emit = defineEmits(['close', 'new']);

function pick(id) {
    term.activateTerminal(id);
    emit('close');
}

function close(tab) {
    if (window.confirm(`关闭终端「${term.terminalTitle(tab)}」？`)) term.closeTerminal(tab.id);
}
</script>

<template>
    <div class="flex min-h-0 flex-col">
        <div class="shrink-0 p-2">
            <button @click="emit('new')"
                :disabled="!ws.canUseActions"
                class="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50">
                <span class="text-base leading-none text-zinc-600">＋</span>
                <span>新终端</span>
            </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <div v-if="!term.terminalTabs.length" class="py-12 text-center text-xs text-zinc-600">
                等待终端列表...
            </div>
            <div
                v-for="tab in term.terminalTabs"
                :key="tab.id"
                class="term-row flex cursor-pointer items-center gap-2 rounded-lg py-2 pl-3 pr-2 transition-colors hover:bg-zinc-800"
                :class="{ 'bg-zinc-800': tab.id === term.activeTerminalId }"
                @click="pick(tab.id)"
            >
                <span class="h-1.5 w-1.5 shrink-0 rounded-full"
                    :style="{ background: tab.id === term.activeTerminalId ? 'var(--color-accent)' : 'var(--color-line-hi)' }"></span>
                <div class="min-w-0 flex-1">
                    <div class="truncate text-[13px] text-zinc-100">{{ term.terminalTitle(tab) }}</div>
                    <div class="mt-0.5 truncate font-mono text-[11px] text-zinc-600">{{ tab.cwd }}</div>
                </div>
                <button class="term-act h-7 w-7 shrink-0 rounded text-xs text-zinc-500"
                    :disabled="!ws.canUseActions"
                    title="关闭终端" @click.stop="close(tab)">✕</button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.term-act:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-bad) 18%, transparent);
    color: var(--color-bad);
}
.term-act:disabled { opacity: 0.4; cursor: not-allowed; }
@media (hover: hover) {
    .term-act { opacity: 0; transition: opacity 0.12s; }
    .term-row:hover .term-act { opacity: 1; }
}
</style>

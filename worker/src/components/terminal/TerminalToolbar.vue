<script setup>
import { ref } from 'vue';
import { useTerminalStore } from '@/stores/terminal';
import { useWsStore } from '@/stores/ws';
import NewTerminalModal from './NewTerminalModal.vue';

const term = useTerminalStore();
const ws = useWsStore();
const showNewModal = ref(false);
</script>

<template>
    <div class="shrink-0 border-b border-zinc-800 bg-zinc-900">
        <div class="flex items-center gap-1 px-2 py-2 overflow-x-auto">
            <div
                v-for="tab in term.terminalTabs"
                :key="tab.id"
                class="group flex h-9 max-w-[220px] shrink-0 items-center gap-2 rounded-lg border px-3 text-sm transition-colors"
                :class="tab.id === term.activeTerminalId
                    ? 'border-emerald-700 bg-emerald-900/30 text-zinc-100'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100'"
            >
                <button class="flex min-w-0 flex-1 items-center gap-2 text-left" @click="term.activateTerminal(tab.id)">
                    <span class="truncate">{{ term.terminalTitle(tab) }}</span>
                    <span class="truncate text-[10px] text-zinc-500">{{ tab.cwd }}</span>
                </button>
                <button
                    class="ml-auto hidden h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 group-hover:flex"
                    :disabled="!ws.canUseActions"
                    @click.stop="term.closeTerminal(tab.id)"
                >
                    ✕
                </button>
            </div>

            <button
                class="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                title="新终端"
                :disabled="!ws.canUseActions"
                @click="ws.canUseActions && (showNewModal = true)"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </button>
        </div>

        <NewTerminalModal :open="showNewModal && ws.canUseActions" @close="showNewModal = false" />
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useWsStore } from '@/stores/ws';
import { useViewStore } from '@/stores/view';
import { useAgentStore, threadTitle } from '@/stores/agent';
import { useTerminalStore } from '@/stores/terminal';

const ws = useWsStore();
const view = useViewStore();
const agent = useAgentStore();
const term = useTerminalStore();
const route = useRoute();

const app = computed(() => view.appOf(route.path));

// 有侧栏的应用把「当前打开的东西」放在标题上，其余显示应用名
const title = computed(() => {
    if (route.name === 'chat') {
        if (!agent.currentId) return '新对话';
        return threadTitle(agent.threads.find((thread) => thread.id === agent.currentId));
    }
    if (route.name === 'terminal') {
        const tab = term.terminalTabs.find((item) => item.id === term.activeTerminalId);
        return tab ? term.terminalTitle(tab) : '终端';
    }
    return app.value?.label || '';
});
</script>

<template>
    <header class="safe-top relative z-40 shrink-0 flex items-center gap-2 px-2 py-2 bg-zinc-900/80 backdrop-blur border-b border-zinc-800">
        <button v-if="app?.side"
            @click="view.openSide"
            class="shrink-0 w-9 h-9 flex items-center justify-center text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            title="菜单">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>

        <div class="min-w-0 flex-1" :class="{ 'pl-2': !app?.side }">
            <div class="truncate font-serif font-bold text-[15px] tracking-tight text-zinc-100">{{ title }}</div>
        </div>

        <div class="flex shrink-0 items-center gap-1.5" :title="ws.statusText">
            <span
                class="w-2 h-2 rounded-full shrink-0"
                :class="{
                    'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]': ws.state === 'connected',
                    'bg-amber-400 pulse': (ws.state === 'pending' || ws.isReconnecting) && !ws.connectionLost,
                    'bg-red-500': ws.connectionLost || (ws.state === 'offline' && !ws.isReconnecting)
                }"
            ></span>
            <span class="hidden sm:inline truncate text-xs text-zinc-400">{{ ws.statusText }}</span>
        </div>

        <button
            @click="view.toggleApps"
            class="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
            :class="view.showApps ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800'"
            title="应用">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
                <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                <circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
            </svg>
        </button>
    </header>
</template>

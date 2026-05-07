<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useWsStore } from '@/stores/ws';
import { useViewStore } from '@/stores/view';

const ws = useWsStore();
const view = useViewStore();
const route = useRoute();

const currentLabel = computed(() => {
    return view.navItems.find((item) => item.path === route.path)?.label || '终端';
});
</script>

<template>
    <header class="safe-top shrink-0 flex items-center gap-3 px-3 py-2.5 bg-zinc-900/80 backdrop-blur border-b border-zinc-800">
        <button
            @click="view.toggleDrawer"
            class="shrink-0 w-8 h-8 flex items-center justify-center text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            title="菜单">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>

        <div class="min-w-0 flex-1">
            <div class="truncate font-serif font-bold text-[15px] tracking-tight text-zinc-100">{{ currentLabel }}</div>
        </div>

        <div class="ml-auto flex min-w-0 items-center justify-end gap-2 text-right">
            <span
                class="w-2 h-2 rounded-full shrink-0"
                :class="{
                    'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]': ws.state === 'connected',
                    'bg-amber-400 pulse': (ws.state === 'pending' || ws.isReconnecting) && !ws.connectionLost,
                    'bg-red-500': ws.connectionLost || (ws.state === 'offline' && !ws.isReconnecting)
                }"
            ></span>
            <span class="truncate text-xs text-zinc-400">{{ ws.statusText }}</span>
        </div>
    </header>
</template>

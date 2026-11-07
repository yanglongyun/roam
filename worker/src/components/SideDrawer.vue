<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useViewStore } from '@/stores/view';
import { useWsStore } from '@/stores/ws';
import TerminalList from '@/components/terminal/TerminalList.vue';
import NewTerminalModal from '@/components/terminal/NewTerminalModal.vue';

const view = useViewStore();
const ws = useWsStore();
const route = useRoute();

const app = computed(() => view.appOf(route.path));
const showNewTerminal = ref(false);

// 切换应用时收起侧栏
watch(() => route.path, () => view.closeSide());

function newTerminal() {
    view.closeSide();
    showNewTerminal.value = true;
}
</script>

<template>
    <div v-if="view.showSide && app?.side"
        class="fixed inset-0 z-40"
        @click.self="view.closeSide">
        <div class="fade-enter absolute inset-0 bg-black/60" @click="view.closeSide"></div>
        <aside class="drawer-enter absolute left-0 top-0 bottom-0 w-72 max-w-[86vw] bg-zinc-900 border-r border-zinc-800 flex flex-col safe-top safe-bottom">
            <div class="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-zinc-800">
                <div class="font-serif font-bold text-[16px] tracking-tight text-zinc-100">{{ app.label }}</div>
                <button @click="view.closeSide"
                    class="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors">
                    ✕
                </button>
            </div>

            <TerminalList v-if="route.name === 'terminal'" class="min-h-0 flex-1" @close="view.closeSide" @new="newTerminal" />
        </aside>
    </div>

    <NewTerminalModal :open="showNewTerminal && ws.canUseActions" @close="showNewTerminal = false" />
</template>

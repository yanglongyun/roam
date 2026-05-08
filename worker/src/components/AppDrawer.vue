<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useViewStore } from '@/stores/view';

const router = useRouter();
const route = useRoute();
const view = useViewStore();

const showAbout = ref(false);

function navigateTo(path) {
    view.closeDrawer();
    if (route.path !== path) router.push(path);
}

async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch {}
}
</script>

<template>
    <div v-if="view.showDrawer"
        class="fixed inset-0 z-40"
        @click.self="view.closeDrawer">
        <div class="fade-enter absolute inset-0 bg-black/60"></div>
        <aside class="drawer-enter absolute left-0 top-0 bottom-0 w-64 max-w-[80vw] bg-zinc-900 border-r border-zinc-800 flex flex-col safe-top safe-bottom">
            <div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <div class="flex items-baseline gap-2 min-w-0">
                    <div class="font-serif font-bold text-[16px] tracking-tight text-zinc-100">Roam</div>
                    <div class="text-[11px] text-zinc-500">漫游</div>
                </div>
                <button @click="view.closeDrawer"
                    class="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors">
                    ✕
                </button>
            </div>

            <nav class="flex-1 p-2 space-y-1 overflow-y-auto">
                <button v-for="item in view.navItems" :key="item.path"
                    @click="navigateTo(item.path)"
                    class="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors"
                    :class="route.path === item.path
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'">
                    <span v-if="route.path === item.path"
                        class="absolute left-0 top-2 bottom-2 w-[2px] rounded-r"
                        style="background: var(--color-accent);"></span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path :d="item.iconPath" />
                    </svg>
                    <span>{{ item.label }}</span>
                </button>
            </nav>

            <div class="shrink-0 border-t border-zinc-800">
                <button @click="showAbout = !showAbout"
                    class="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
                    <span>关于</span>
                    <span class="text-xs text-zinc-600">{{ showAbout ? '▾' : '▸' }}</span>
                </button>
                <div v-if="showAbout" class="px-4 pb-3 space-y-2 text-xs">
                    <div class="text-zinc-500">本项目把本机终端 / 文件 / 屏幕带到任意浏览器,Worker 只做中继,数据不落地。</div>
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-zinc-500 shrink-0">项目</span>
                        <a href="https://github.com/valueriver/roam" target="_blank" rel="noopener"
                            class="text-emerald-400 hover:text-emerald-300 truncate">github.com/valueriver/roam</a>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-zinc-500 shrink-0">微信</span>
                        <button @click="copy('agentready')"
                            class="font-mono text-zinc-200 hover:text-emerald-300 transition-colors"
                            title="点击复制">agentready</button>
                    </div>
                </div>
            </div>

        </aside>
    </div>
</template>

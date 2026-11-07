<script setup>
import { useRoute, useRouter } from 'vue-router';
import { useViewStore } from '@/stores/view';
import { useAssistantStore } from '@/stores/agent';

const view = useViewStore();
const assistant = useAssistantStore();
const route = useRoute();
const router = useRouter();

function open(path) {
    view.closeApps();
    if (route.path !== path) router.push(path);
}
</script>

<template>
    <div v-if="view.showApps" class="fixed inset-0 z-30" @click.self="view.closeApps">
        <div class="apps-panel fade-enter absolute right-2 w-[264px] max-w-[calc(100vw-16px)] rounded-xl border border-zinc-800 bg-zinc-900 p-2 shadow-2xl">
            <div class="grid grid-cols-3 gap-1">
                <button v-for="item in view.apps" :key="item.path"
                    @click="open(item.path)"
                    class="flex flex-col items-center gap-1.5 rounded-lg px-1 py-3 text-xs transition-colors"
                    :class="view.appOf(route.path)?.path === item.path
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'">
                    <span class="app-icon flex h-10 w-10 items-center justify-center rounded-xl"
                        :class="{ on: view.appOf(route.path)?.path === item.path }">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path :d="item.iconPath" />
                        </svg>
                    </span>
                    <span>{{ item.label }}<span v-if="item.path === '/assistant' && assistant.unread"
                        class="ml-1 rounded-full bg-accent px-1.5 text-[10px] text-bg">{{ assistant.unread > 99 ? '99+' : assistant.unread }}</span></span>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.apps-panel {
    top: calc(max(env(safe-area-inset-top), 0.5rem) + 50px);
}
.app-icon {
    background: var(--color-bg-hi);
    border: 1px solid var(--color-line);
    color: var(--color-muted);
}
.app-icon.on {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    color: var(--color-accent);
}
</style>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useWsStore } from '@/stores/ws';
import HistoryPanel from '@/components/chat/HistoryPanel.vue';
import MessageStream from '@/components/chat/MessageStream.vue';
import Composer from '@/components/chat/Composer.vue';

const chat = useChatStore();
const ws = useWsStore();
const showHistory = ref(false);

async function newChat() {
    showHistory.value = false;
    await chat.newChat();
}

onMounted(() => {
    chat.bind();
    if (ws.showActions) chat.refresh();
});

// 断线重连后重新拉列表；若有打开的对话也重载一次，补上断线期间错过的流式事件
watch(() => ws.showActions, (ready) => {
    if (!ready) return;
    chat.refresh();
    if (chat.currentId) chat.openChat(chat.currentId);
});
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col bg-zinc-950">
        <div class="shrink-0 border-b border-zinc-800 bg-zinc-900/70 px-3 py-2 flex items-center gap-2">
            <button
                @click="showHistory = !showHistory"
                class="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded border px-3 text-sm transition-colors"
                :class="showHistory
                    ? 'border-emerald-700 bg-emerald-900/30 text-emerald-300'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700'"
                title="历史对话">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l3 3" />
                </svg>
                <span>历史</span>
            </button>
            <div class="min-w-0 flex-1 truncate text-sm text-zinc-300">{{ chat.currentTitle || '新对话' }}</div>
            <button
                @click="newChat"
                :disabled="!ws.showActions"
                class="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 transition-colors hover:bg-zinc-700 active:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
                title="新对话">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 5v14 M5 12h14" />
                </svg>
                <span>新对话</span>
            </button>
        </div>

        <div class="relative flex min-h-0 flex-1 overflow-hidden">
            <template v-if="showHistory">
                <HistoryPanel class="chat-side" @close="showHistory = false" @newChat="newChat" />
                <div class="chat-side-mask" @click="showHistory = false"></div>
            </template>
            <div class="flex min-w-0 min-h-0 flex-1 flex-col">
                <MessageStream />
                <Composer />
            </div>
        </div>
    </div>
</template>

<style scoped>
.chat-side {
    width: 288px;
    flex-shrink: 0;
}
.chat-side-mask { display: none; }

@media (max-width: 768px) {
    .chat-side {
        position: absolute;
        inset: 0 auto 0 0;
        z-index: 30;
        width: min(320px, 86vw);
        box-shadow: 18px 0 44px #00000066;
        animation: side-in 0.18s ease;
    }
    .chat-side-mask {
        position: absolute;
        inset: 0;
        z-index: 25;
        display: block;
        background: #00000066;
    }
}

@keyframes side-in {
    from { opacity: 0; transform: translateX(-18px); }
}
</style>

<script setup>
import { onMounted, watch } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useWsStore } from '@/stores/ws';
import MessageStream from '@/components/chat/MessageStream.vue';
import Composer from '@/components/chat/Composer.vue';

const chat = useChatStore();
const ws = useWsStore();

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
        <MessageStream />
        <Composer />
    </div>
</template>

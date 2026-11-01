<script setup>
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';
import { fmtTime } from '@/lib/chat/format';

const chat = useChatStore();
const emit = defineEmits(['close']);

const groups = computed(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 86400000;
    const buckets = [
        { label: '今天', items: [] },
        { label: '最近 7 天', items: [] },
        { label: '更早', items: [] },
    ];
    for (const conversation of chat.conversations) {
        const ts = Number(conversation.updatedAt || 0);
        if (ts >= today) buckets[0].items.push(conversation);
        else if (ts >= today - day * 6) buckets[1].items.push(conversation);
        else buckets[2].items.push(conversation);
    }
    return buckets.filter((bucket) => bucket.items.length);
});

async function pickChat(id) {
    emit('close');
    await chat.openChat(id);
}

async function newChat() {
    emit('close');
    await chat.newChat();
}

async function doRename(conversation) {
    const title = window.prompt('重命名对话', conversation.title || '');
    if (title != null && title.trim()) await chat.rename(conversation.id, title.trim());
}

async function doDelete(conversation) {
    if (window.confirm(`删除对话「${conversation.title || '未命名'}」？不可恢复。`)) {
        await chat.remove(conversation.id);
    }
}
</script>

<template>
    <div class="flex min-h-0 flex-col overflow-hidden">
        <div class="shrink-0 p-2">
            <button @click="newChat"
                class="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100">
                <span class="text-base leading-none text-zinc-600">＋</span>
                <span>新对话</span>
            </button>
        </div>

        <div class="hist-list min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <div v-if="!chat.conversations.length" class="py-12 text-center text-xs text-zinc-600">
                暂无对话记录
            </div>
            <template v-for="group in groups" :key="group.label">
                <div class="px-3 pb-1.5 pt-4 text-xs font-semibold text-zinc-500">{{ group.label }}</div>
                <div
                    v-for="conversation in group.items"
                    :key="conversation.id"
                    class="hist-row flex cursor-pointer items-center gap-2 rounded-lg py-2 pl-3 pr-2 transition-colors hover:bg-zinc-800"
                    :class="{ 'bg-zinc-800': conversation.id === chat.currentId }"
                    @click="pickChat(conversation.id)"
                >
                    <div class="min-w-0 flex-1">
                        <div class="truncate text-[13px] text-zinc-100">
                            <span v-if="conversation.state === 'running'" class="pulse mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style="background: var(--color-accent);"></span>{{ conversation.title || '未命名' }}
                        </div>
                        <div class="mt-0.5 text-[11px] text-zinc-600">{{ conversation.messageCount }} 条 · {{ fmtTime(conversation.updatedAt) }}</div>
                    </div>
                    <button class="hist-act h-7 w-7 shrink-0 rounded text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100"
                        title="重命名" @click.stop="doRename(conversation)">✎</button>
                    <button class="hist-act danger h-7 w-7 shrink-0 rounded text-xs text-zinc-500"
                        title="删除" @click.stop="doDelete(conversation)">✕</button>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.hist-list { scrollbar-width: none; }
.hist-list::-webkit-scrollbar { display: none; }
.hist-act.danger:hover {
    background: color-mix(in srgb, var(--color-bad) 18%, transparent);
    color: var(--color-bad);
}
@media (hover: hover) {
    .hist-act { opacity: 0; transition: opacity 0.12s; }
    .hist-row:hover .hist-act { opacity: 1; }
}
</style>

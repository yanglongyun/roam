<script setup>
import { computed, nextTick, onActivated, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore } from '@/stores/chat';
import { renderMd } from '@/lib/chat/format';
import { isToolRow } from '@/lib/chat/messages';
import ToolGroup from './ToolGroup.vue';

const chat = useChatStore();
const router = useRouter();
const streamRef = ref(null);

const showTyping = computed(() => {
    if (!chat.busy) return false;
    const last = chat.messages[chat.messages.length - 1];
    return !(last && last.role === 'assistant' && last.streaming);
});

const blocks = computed(() => {
    const out = [];
    for (const message of chat.messages) {
        if (isToolRow(message)) {
            const last = out[out.length - 1];
            if (last?.kind === 'tools') {
                last.items.push(message);
            } else {
                out.push({ kind: 'tools', key: `tools:${message._key}`, items: [message] });
            }
            continue;
        }
        out.push({ kind: 'message', key: message._key, message });
    }
    return out;
});

function isPinned() {
    const el = streamRef.value;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}

function toBottom() {
    nextTick(() => requestAnimationFrame(() => {
        const el = streamRef.value;
        if (el) el.scrollTop = el.scrollHeight;
    }));
}

watch(() => chat.viewSeq, toBottom);
watch(() => chat.streamTick, () => {
    if (isPinned()) toBottom();
});
onActivated(toBottom);

async function onScroll() {
    const el = streamRef.value;
    if (!el || chat.loadingOlder || !chat.hasMore) return;
    if (el.scrollTop > 48) return;
    const prevH = el.scrollHeight;
    const prevTop = el.scrollTop;
    const count = await chat.loadOlder();
    if (!count) return;
    await nextTick();
    requestAnimationFrame(() => { el.scrollTop = prevTop + (el.scrollHeight - prevH); });
}

function goSettings() {
    router.push('/settings');
}
</script>

<template>
    <div ref="streamRef" class="min-h-0 flex-1 overflow-y-auto px-3 py-4" @scroll.passive="onScroll">
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-3">
            <div v-if="chat.loadingOlder" class="py-1 text-center text-xs text-zinc-500">加载更早…</div>
            <div v-else-if="chat.hasMore && chat.messages.length" class="py-1 text-center text-xs text-zinc-600">↑ 上滑加载更早</div>

            <div v-if="!chat.messages.length" class="py-16 text-center">
                <div class="font-serif text-2xl font-bold tracking-tight text-zinc-100">Roam <em class="text-emerald-400">助手</em></div>
                <div class="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-zinc-500">
                    跑在你电脑上的 AI，可以执行命令、操作浏览器和桌面。直接说你想做什么。
                </div>
            </div>

            <template v-for="block in blocks" :key="block.key">
                <ToolGroup v-if="block.kind === 'tools'" :items="block.items" />

                <div v-else-if="block.message.role === 'user'" class="flex justify-end">
                    <div class="bubble me">{{ block.message.content }}</div>
                </div>

                <div v-else-if="block.message.role === 'assistant'" class="min-w-0">
                    <div class="md" v-html="renderMd(block.message.content)"></div>
                    <div v-if="block.message.usage" class="mt-1.5 font-mono text-[10.5px] text-zinc-600">
                        prompt {{ block.message.usage.prompt_tokens ?? '?' }} · completion {{ block.message.usage.completion_tokens ?? '?' }}
                    </div>
                </div>

                <div v-else-if="block.message.type === 'shot'" class="flex justify-center">
                    <img :src="block.message.dataUrl" alt="屏幕截图" class="max-w-full rounded-lg border border-zinc-800" />
                </div>

                <div v-else-if="block.message.role === 'system'" class="flex justify-center">
                    <span class="system-event">
                        {{ block.message.content }}
                        <button v-if="block.message.code === 'model_settings_missing'"
                            class="ml-1 text-emerald-400 underline underline-offset-2" @click="goSettings">去设置</button>
                    </span>
                </div>
            </template>

            <div v-if="showTyping" class="typing"><i></i><i></i><i></i></div>
        </div>
    </div>
</template>

<style scoped>
.bubble.me {
    max-width: 85%;
    min-width: 0;
    padding: 8px 13px;
    border-radius: 14px;
    border-bottom-right-radius: 4px;
    background: var(--color-bg-hi);
    border: 1px solid var(--color-line-hi);
    color: var(--color-ink);
    font-size: 13.5px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
}
.md { user-select: text; overflow-wrap: anywhere; }
.md :deep(pre) { max-width: 100%; overflow-x: auto; }
.system-event {
    max-width: 100%;
    border-radius: 999px;
    border: 1px solid var(--color-line);
    background: var(--color-bg-elev);
    padding: 5px 14px;
    text-align: center;
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-muted);
}
.typing { display: flex; gap: 5px; padding: 6px 2px; }
.typing i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-accent);
    animation: dot-bounce 1.2s ease-in-out infinite;
}
.typing i:nth-child(2) { animation-delay: 0.2s; }
.typing i:nth-child(3) { animation-delay: 0.4s; }
</style>

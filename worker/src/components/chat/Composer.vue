<script setup>
import { computed, ref } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useWsStore } from '@/stores/ws';

const chat = useChatStore();
const ws = useWsStore();
const input = ref('');
const taRef = ref(null);

const canSend = computed(() => ws.showActions && !chat.busy && input.value.trim().length > 0);

function onKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        send();
    }
}

function send() {
    if (!canSend.value) return;
    const text = input.value;
    input.value = '';
    if (taRef.value) taRef.value.style.height = 'auto';
    chat.send(text);
}

function autoGrow(event) {
    const el = event.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}
</script>

<template>
    <div class="safe-bottom shrink-0 border-t border-zinc-800 bg-zinc-900/70 px-3 pt-2">
        <div class="inputwrap mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-zinc-700 bg-zinc-950 py-1.5 pl-3 pr-1.5">
            <textarea
                ref="taRef"
                v-model="input"
                rows="1"
                :placeholder="ws.showActions ? '发消息，回车发送，Shift+回车换行' : '等待连接…'"
                :disabled="!ws.showActions"
                @keydown="onKeydown"
                @input="autoGrow"
                class="min-w-0 flex-1 resize-none border-0 bg-transparent py-1.5 leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500"
            ></textarea>
            <button v-if="chat.busy"
                class="sendbtn stop"
                title="停止" @click="chat.abort()">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
            </button>
            <button v-else
                class="sendbtn"
                :disabled="!canSend" title="发送" @click="send">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5 M5 12l7-7 7 7" /></svg>
            </button>
        </div>
    </div>
</template>

<style scoped>
.inputwrap { transition: border-color 0.15s ease; }
.inputwrap:focus-within { border-color: var(--color-accent); }
textarea { max-height: 140px; }
.sendbtn {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-accent);
    color: var(--color-bg);
    transition: opacity 0.15s ease, background 0.15s ease;
}
.sendbtn:hover:not(:disabled) { background: var(--color-accent-hi); }
.sendbtn:disabled { opacity: 0.35; cursor: default; }
.sendbtn.stop { background: var(--color-bad); color: #fff; }
</style>

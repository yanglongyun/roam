<script setup>
import { computed, onMounted, nextTick, ref, watch } from 'vue';
import { useAgentStore } from '@/stores/agent';
import { useWsStore } from '@/stores/ws';
import AgentToolChip from '@/components/agent/AgentToolChip.vue';
import AgentConfigForm from '@/components/agent/AgentConfigForm.vue';
import { renderMd } from '@/utils/renderMd';

const ws = useWsStore();
const agent = useAgentStore();
const listRef = ref(null);
const textareaRef = ref(null);
const showSessions = ref(false);
const showSettings = ref(false);

function isNearBottom() {
    const el = listRef.value;
    if (!el) return true;
    return el.scrollHeight - (el.scrollTop + el.clientHeight) < 140;
}

function scrollToBottom(smooth = true) {
    nextTick(() => {
        const el = listRef.value;
        if (!el) return;
        if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        else el.scrollTop = el.scrollHeight;
    });
}

function onScroll() {
    const el = listRef.value;
    if (!el || !agent.hasMore) return;
    if (el.scrollTop < 50) {
        const oldHeight = el.scrollHeight;
        agent.loadMore();
        nextTick(() => { el.scrollTop = el.scrollHeight - oldHeight; });
    }
}

function openSettings() { showSettings.value = true; }

function startNewChat() {
    agent.newSession();
}

function onComposerKey(event) {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    event.preventDefault();
    submit();
}

function submit() {
    if (!canSend.value) return;
    agent.send();
}

const canSend = computed(
    () => ws.showActions && agent.configured && !agent.running && agent.input.trim().length > 0
);

const composerPlaceholder = computed(() => {
    if (!ws.showActions) return '等待客户端连接……';
    if (!agent.configured) return '先去右上角"设置"填 API URL / Key / Model';
    if (agent.running) return '思考中……';
    return '让 agent 做点事……';
});

const sessionTitle = computed(() => agent.sessionTitle || '新会话');

function fmtTime(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + 'Z');
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
}

function pickSession(id) {
    agent.switchSession(id);
    showSessions.value = false;
}

function removeSession(id) {
    if (!confirm('删除这个会话？消息一并清掉。')) return;
    agent.deleteSession(id);
}

onMounted(() => {
    agent.initialize();
    scrollToBottom(false);
});

watch(() => agent.sessionId, () => {
    scrollToBottom(false);
});

watch(() => agent.messages.length, (nextLen, prevLen) => {
    if (prevLen === 0 && nextLen > 0) {
        scrollToBottom(false);
        return;
    }
    if (!isNearBottom()) return;
    if (prevLen > 0 && nextLen - prevLen > 5) return;
    scrollToBottom(true);
});

watch(
    () => agent.messages[agent.messages.length - 1]?.content,
    () => { if (isNearBottom()) scrollToBottom(true); }
);
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col bg-bg text-ink">
        <!-- Header -->
        <div class="flex items-center gap-3 px-4 py-3 border-b border-line bg-bg">
            <div class="min-w-0 flex-1">
                <div class="font-serif font-bold text-[15px] tracking-tight truncate text-ink">Agent</div>
                <div class="mt-1 truncate text-[11px] text-faint">{{ sessionTitle }}</div>
            </div>
            <div class="flex items-center gap-1">
                <button class="icon-btn" title="新建会话" @click="startNewChat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </button>
                <button class="icon-btn" title="历史会话" @click="showSessions = true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="9"/>
                        <polyline points="12 7 12 12 15 14"/>
                    </svg>
                </button>
                <button class="icon-btn" title="设置" @click="openSettings">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Message area -->
        <div ref="listRef" class="min-h-0 flex-1 overflow-y-auto px-4 py-5 bg-bg" @scroll="onScroll">
            <div v-if="!agent.messages.length" class="text-center pt-6 max-w-[480px] mx-auto">
                <h1 class="font-serif font-bold tracking-tight mb-3 text-ink text-[28px]">
                    让 agent 动手
                </h1>
                <p class="text-[13px] text-faint leading-relaxed mb-8">
                    人生苦短，挑个聪明的多模态模型。笨模型浪费时间，单模态的还帮不上浏览器。
                </p>

                <div v-if="!agent.configured" class="text-left">
                    <div class="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-accent mb-3 text-center">
                        先配模型
                    </div>
                    <AgentConfigForm />
                </div>
            </div>

            <div v-else class="flex flex-col gap-4">
                <div v-if="agent.hasMore" class="text-center text-[11px] text-faint py-1">
                    正在加载更早的消息…
                </div>

                <template v-for="(m, i) in agent.messages" :key="m._key || i">
                    <!-- user -->
                    <div v-if="m.role === 'user'"
                        class="self-end max-w-[85%] rounded-[14px] rounded-br-[4px] bg-bg-hi text-ink px-3.5 py-2.5 whitespace-pre-wrap break-words text-[13px]">
                        {{ m.content }}
                    </div>

                    <!-- assistant -->
                    <div v-else-if="m.role === 'assistant'" class="self-start max-w-full">
                        <div class="text-[10px] font-mono font-bold tracking-[0.18em] uppercase mb-1.5 text-accent">
                            ASSISTANT
                        </div>
                        <div class="md" v-html="renderMd(m.content || '')"></div>
                    </div>

                    <!-- tool_call -->
                    <AgentToolChip v-else-if="m.type === 'tool_call'"
                        :title="m.title"
                        :command="m.command"
                        :detail="m.detail"
                        :result="m.result"
                        :status="m.status" />

                    <!-- error -->
                    <div v-else-if="m.role === 'error'"
                        class="self-start max-w-full rounded-lg border border-bad/30 bg-bad/10 text-bad px-3 py-2 text-[12.5px]">
                        ERROR: {{ m.content }}
                    </div>
                </template>

                <div v-if="agent.running" class="self-start flex items-center gap-2 text-[12px] text-faint">
                    <span>思考中</span>
                    <span class="inline-flex gap-[3px]">
                        <span v-for="i in 3" :key="i" class="dot-bounce-dot"
                            :style="{ animationDelay: `${(i - 1) * 0.2}s` }"></span>
                    </span>
                </div>
            </div>
        </div>

        <!-- Composer -->
        <form class="flex-shrink-0 px-4 py-3.5 border-t border-line bg-bg" @submit.prevent="submit">
            <div>
                <div class="composer-shell flex items-end gap-2 rounded-[14px] border border-line bg-bg-elev pl-2 pr-2 py-2 transition-colors focus-within:border-accent">
                    <textarea ref="textareaRef"
                        v-model="agent.input"
                        rows="1"
                        :placeholder="composerPlaceholder"
                        class="flex-1 bg-transparent border-0 outline-none resize-none py-1.5 px-1.5 text-[13px] leading-[1.5] text-ink placeholder:text-faint composer-textarea"
                        :disabled="!ws.showActions || !agent.configured || agent.running"
                        @keydown="onComposerKey"></textarea>

                    <button v-if="agent.running" type="button"
                        class="w-10 h-10 rounded-[10px] bg-bad text-white flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-90"
                        title="中断"
                        @click="agent.abort">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="1.5"/>
                        </svg>
                    </button>
                    <button v-else type="submit"
                        class="w-10 h-10 rounded-[10px] bg-accent text-bg flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
                        :disabled="!canSend"
                        title="发送">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"/>
                            <polyline points="13 6 19 12 13 18"/>
                        </svg>
                    </button>
                </div>
                <p class="text-center text-[10.5px] mt-2 text-faint">
                    Enter 发送 · Shift+Enter 换行 · Ctrl/⌘+Enter 也发送
                </p>
            </div>
        </form>

        <!-- 会话列表 modal -->
        <div v-if="showSessions"
            class="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
            @click.self="showSessions = false">
            <section class="flex h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-[14px] border border-line bg-bg-elev shadow-2xl">
                <header class="flex items-center justify-between border-b border-line px-4 py-3">
                    <div class="font-serif font-bold text-[15px] tracking-tight text-ink">历史会话</div>
                    <div class="flex items-center gap-2">
                        <button class="rounded-md px-2.5 py-1 text-[12px] bg-accent text-bg hover:opacity-90"
                            @click="startNewChat(); showSessions = false;">+ 新建</button>
                        <button class="h-8 w-8 rounded-md flex items-center justify-center bg-bg-hi text-muted hover:opacity-80"
                            @click="showSessions = false">✕</button>
                    </div>
                </header>
                <div class="min-h-0 flex-1 overflow-y-auto p-2">
                    <div v-if="!agent.sessions.length"
                        class="rounded-[10px] border border-line bg-bg text-muted px-4 py-5 text-[13px] m-2">
                        还没有会话。
                    </div>
                    <div v-for="s in agent.sessions" :key="s.id"
                        class="group relative flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
                        :class="s.id === agent.sessionId ? 'bg-bg-hi' : 'hover:bg-bg-hi'"
                        @click="pickSession(s.id)">
                        <span v-if="s.id === agent.sessionId"
                            class="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-accent"></span>
                        <div class="flex-1 min-w-0">
                            <div class="truncate text-[13px] text-ink">{{ s.title || '新会话' }}</div>
                            <div class="text-[10.5px] text-faint mt-0.5">{{ fmtTime(s.updatedAt) }}</div>
                        </div>
                        <button class="opacity-0 group-hover:opacity-100 text-faint hover:text-bad text-sm px-2 transition-opacity"
                            title="删除"
                            @click.stop="removeSession(s.id)">×</button>
                    </div>
                </div>
            </section>
        </div>

        <!-- 设置 modal -->
        <div v-if="showSettings"
            class="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
            <section class="w-full max-w-2xl rounded-[14px] border border-line bg-bg-elev shadow-2xl">
                <header class="flex items-start justify-between border-b border-line px-4 py-3">
                    <div>
                        <div class="font-serif font-bold text-[15px] tracking-tight text-ink">Agent 设置</div>
                        <div class="mt-1 text-[11px] text-faint">
                            模型参数保存到客户端 ~/.meem/meem.db，重启也在。
                        </div>
                    </div>
                    <button class="h-8 w-8 rounded-md flex items-center justify-center bg-bg-hi text-muted hover:opacity-80"
                        @click="showSettings = false">✕</button>
                </header>

                <div class="px-4 py-4">
                    <AgentConfigForm @saved="showSettings = false" />
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.icon-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-line);
    border-radius: 10px;
    background: var(--color-bg-elev);
    color: var(--color-ink);
    transition: border-color 0.12s ease;
}
.icon-btn:hover { border-color: var(--color-accent); }

.composer-textarea {
    min-height: 28px;
    max-height: 180px;
    field-sizing: content;
}

.dot-bounce-dot {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-accent);
    animation: dot-bounce 1.2s ease-in-out infinite;
}
</style>

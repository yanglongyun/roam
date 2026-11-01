<script setup>
// 助理的左侧菜单：新对话 · 置顶 · 最近对话。
// 行尾「更多」按钮点开是置顶 / 重命名 / 删除；正在跑的行画呼吸点。置顶组内可拖拽排序。
import { computed, ref } from 'vue';
import { useAgentStore, threadTitle } from '@/stores/agent';
import Icon from './Icon.vue';

const emit = defineEmits(['close']);
const agent = useAgentStore();

const pinned = computed(() => agent.pinOrder.map((id) => agent.threads.find((thread) => thread.id === id)).filter(Boolean));
const recent = computed(() => agent.threads.filter((thread) => !agent.pinOrder.includes(thread.id)));

const menu = ref('');
const dragging = ref('');
const drop = ref(null); // { id, after }

function newChat() {
    agent.createDraft();
    emit('close');
}

function pick(id) {
    menu.value = '';
    void agent.openThread(id);
    emit('close');
}

async function rename(thread) {
    menu.value = '';
    const title = window.prompt('重命名对话', threadTitle(thread));
    if (title != null && title.trim()) await agent.renameThread(thread.id, title.trim());
}

async function remove(thread) {
    menu.value = '';
    if (window.confirm(`删除对话「${threadTitle(thread)}」？不可恢复。`)) await agent.removeThread(thread.id);
}

async function togglePin(thread) {
    menu.value = '';
    await agent.pinThread(thread.id, !agent.pinOrder.includes(thread.id));
}

function onDragOver(event, thread) {
    if (!dragging.value) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    drop.value = { id: thread.id, after: event.clientY > box.top + box.height / 2 };
}

function onDragEnd() {
    if (dragging.value && drop.value && dragging.value !== drop.value.id) {
        const ids = agent.pinOrder.filter((id) => id !== dragging.value);
        let index = ids.indexOf(drop.value.id);
        if (drop.value.after) index += 1;
        ids.splice(index, 0, dragging.value);
        void agent.reorderPins(ids);
    }
    dragging.value = '';
    drop.value = null;
}

function onScroll(event) {
    const el = event.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) void agent.loadMoreThreads();
}
</script>

<template>
    <div class="flex min-h-0 flex-col">
        <div class="shrink-0 p-2">
            <button @click="newChat"
                class="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100">
                <span class="text-base leading-none text-zinc-600">＋</span>
                <span>新对话</span>
            </button>
        </div>

        <div class="sess-list min-h-0 flex-1 overflow-y-auto px-2 pb-3" @scroll.passive="onScroll" @click.self="menu = ''">
            <div v-if="!agent.threads.length" class="py-12 text-center text-xs text-zinc-600">暂无对话记录</div>

            <template v-for="group in [{ label: '置顶', list: pinned, pinned: true }, { label: '最近', list: recent, pinned: false }]" :key="group.label">
                <template v-if="group.list.length">
                    <div class="px-3 pb-1.5 pt-4 text-xs font-semibold text-zinc-500">{{ group.label }}</div>
                    <div v-for="thread in group.list" :key="thread.id" class="relative">
                        <div
                            class="sess-row flex cursor-pointer items-center gap-2 rounded-lg py-2 pl-3 pr-1 transition-colors hover:bg-zinc-800"
                            :class="{
                                'bg-zinc-800': thread.id === agent.currentId,
                                dragging: dragging === thread.id,
                                'drop-before': drop?.id === thread.id && !drop.after && dragging !== thread.id,
                                'drop-after': drop?.id === thread.id && drop.after && dragging !== thread.id,
                            }"
                            :draggable="group.pinned"
                            @dragstart="dragging = thread.id"
                            @dragover="group.pinned && onDragOver($event, thread)"
                            @dragend="onDragEnd"
                            @click="pick(thread.id)"
                        >
                            <span v-if="thread.running" class="pulse h-1.5 w-1.5 shrink-0 rounded-full" style="background: var(--color-accent);"></span>
                            <span class="min-w-0 flex-1 truncate text-[13px] text-zinc-100">{{ threadTitle(thread) }}</span>
                            <button class="sess-more h-7 w-7 shrink-0 flex items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100"
                                :class="{ on: menu === thread.id }"
                                title="更多" @click.stop="menu = menu === thread.id ? '' : thread.id">
                                <Icon name="more" :size="16" />
                            </button>
                        </div>
                        <div v-if="menu === thread.id" class="sess-menu">
                            <button @click="togglePin(thread)"><Icon name="pin" :size="14" /><span>{{ group.pinned ? '取消置顶' : '置顶' }}</span></button>
                            <button @click="rename(thread)"><Icon name="pen" :size="14" /><span>重命名</span></button>
                            <button class="danger" :disabled="thread.running" @click="remove(thread)">✕<span>删除</span></button>
                        </div>
                    </div>
                </template>
            </template>

            <div v-if="agent.loadingThreads" class="py-3 text-center text-xs text-zinc-600">加载中…</div>
        </div>
    </div>
</template>

<style scoped>
.sess-list { scrollbar-width: none; }
.sess-list::-webkit-scrollbar { display: none; }
.sess-row.dragging { opacity: 0.4; }
.sess-row.drop-before { box-shadow: inset 0 2px 0 var(--color-accent); }
.sess-row.drop-after { box-shadow: inset 0 -2px 0 var(--color-accent); }
@media (hover: hover) {
    .sess-more { opacity: 0; transition: opacity 0.12s; }
    .sess-row:hover .sess-more, .sess-more.on { opacity: 1; }
}
.sess-menu {
    position: absolute;
    right: 4px;
    top: calc(100% - 2px);
    z-index: 10;
    min-width: 132px;
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--color-line-hi);
    background: var(--color-bg-hi);
    box-shadow: 0 10px 30px #00000080;
}
.sess-menu button {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--color-ink);
    text-align: left;
}
.sess-menu button:hover { background: color-mix(in srgb, var(--color-ink) 8%, transparent); }
.sess-menu button.danger { color: var(--color-bad); }
.sess-menu button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>

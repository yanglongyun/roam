<script setup>
// 打开的是任务会话时，顶部一条状态：现在什么状态、干到哪、花了几步。
import { computed } from 'vue';
import { useConversation } from '@/lib/agent/conversation';
import { useTasksStore, STATUS_TEXT, isOpen } from '@/stores/tasks';

const agent = useConversation();
const tasks = useTasksStore();

// 以列表里的为准（进度是后端写进控制面的），列表里没有就用打开时那份。
const task = computed(() => tasks.tasks.find((entry) => entry.id === agent.currentTask?.id) || agent.currentTask);
const tone = computed(() => (task.value?.status === 'needs_human' ? 'warn' : isOpen(task.value) ? 'live' : 'idle'));
const detail = computed(() => {
    const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
    return isOpen(task.value) ? clean(task.value?.progress) : '';
});
</script>

<template>
    <div v-if="agent.currentTask" class="task-bar">
        <span class="task-dot" :class="tone"></span>
        <span class="task-state">{{ STATUS_TEXT[task?.status] || task?.status }}</span>
        <span v-if="detail" class="task-detail">{{ detail }}</span>
        <span v-if="task?.steps" class="task-meta">{{ task.steps }} 步<template v-if="task.cost"> · ${{ task.cost.toFixed(3) }}</template></span>
        <button v-if="isOpen(task)" class="task-stop" :disabled="agent.stopping" @click="tasks.cancel(task)">停止</button>
    </div>
</template>

<style scoped>
.task-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-line);
    background: var(--color-bg-hi);
    font-size: 12px;
}
.task-dot { width: 6px; height: 6px; border-radius: 999px; flex-shrink: 0; background: var(--color-line-hi); }
.task-dot.live { background: var(--color-accent); animation: task-pulse 1.6s ease-in-out infinite; }
.task-dot.warn { background: var(--color-bad); }
.task-state { flex-shrink: 0; color: var(--color-ink); }
.task-detail { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-muted); }
.task-meta { flex-shrink: 0; margin-left: auto; color: var(--color-muted); }
.task-stop {
    flex-shrink: 0;
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid var(--color-line-hi);
    color: var(--color-ink);
    font-size: 12px;
}
.task-stop:hover { background: var(--color-bg); }
.task-stop:disabled { opacity: 0.4; cursor: not-allowed; }
@keyframes task-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
</style>

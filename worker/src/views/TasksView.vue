<script setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTaskAgentStore } from '@/stores/agent';
import { useAgentClientStore } from '@/stores/agent-client';
import { useTasksStore, STATUS_TEXT, isOpen } from '@/stores/tasks';
import { useWsStore } from '@/stores/ws';
import ConversationPane from '@/components/agent/ConversationPane.vue';
import NewTaskModal from '@/components/tasks/NewTaskModal.vue';

const route = useRoute();
const router = useRouter();
const tasks = useTasksStore();
const agent = useTaskAgentStore();
const client = useAgentClientStore();
const ws = useWsStore();
const filter = ref('all');
const opening = ref(false);
const detailError = ref('');
const showCreate = ref(false);
const taskId = computed(() => route.name === 'tasks' ? String(route.params.id || '') : '');
const filters = [
    { id: 'all', label: '全部', match: () => true },
    { id: 'active', label: '进行中', match: (task) => ['queued', 'running'].includes(task.status) },
    { id: 'human', label: '等人决定', match: (task) => task.status === 'needs_human' },
    { id: 'closed', label: '已结束', match: (task) => !isOpen(task) },
];
const visibleTasks = computed(() => tasks.tasks.filter(filters.find((item) => item.id === filter.value).match));
const tone = (task) => task.status === 'needs_human' ? 'warn' : task.status === 'failed' ? 'bad' : isOpen(task) ? 'live' : 'idle';
const deviceName = (task) => {
    const device = ws.devices.find((item) => item.id === task.device_id);
    return device?.name || device?.host || task.device_id || '未指定设备';
};
const updatedAt = (task) => new Date(task.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

tasks.init();
agent.init();
let generation = 0;
watch(() => [route.name, taskId.value, ws.authenticated], async ([name, id, online]) => {
    const mine = ++generation;
    detailError.value = '';
    opening.value = false;
    if (name !== 'tasks' || !id || !online) return;
    opening.value = true;
    try {
        const { task } = await client.request('tasks.get', { id });
        if (mine !== generation) return;
        await tasks.open(task);
    } catch (error) {
        if (mine === generation) detailError.value = error.message || '任务加载失败';
    } finally {
        if (mine === generation) opening.value = false;
    }
}, { immediate: true });

async function cancel(task) {
    if (window.confirm('停止这个任务？已经完成的操作会保留。')) await tasks.cancel(task);
}

async function remove(task) {
    if (window.confirm('删除这个任务及其对话记录？不可恢复。')) await tasks.remove(task);
}

function created(id) {
    showCreate.value = false;
    router.push({ name: 'tasks', params: { id } });
}

let refreshTimer;
function stopRefresh() { clearInterval(refreshTimer); }
onActivated(() => {
    if (ws.authenticated) void tasks.load();
    stopRefresh();
    refreshTimer = setInterval(() => {
        if (ws.authenticated && !tasks.loading) void tasks.load();
    }, 5000);
});
onDeactivated(stopRefresh);
onBeforeUnmount(stopRefresh);
</script>

<template>
    <div class="tasks-app flex min-h-0 flex-1 flex-col">
        <template v-if="taskId">
            <div v-if="opening" class="task-empty">正在打开任务…</div>
            <div v-else-if="detailError" class="task-empty">
                <p>{{ detailError }}</p>
                <button class="task-primary" @click="router.push('/tasks')">返回任务列表</button>
            </div>
            <ConversationPane v-else :key="taskId" :agent="agent" task />
        </template>

        <main v-else class="task-list-scroll">
            <div class="task-list-inner">
                <div class="task-list-heading">
                    <div>
                        <h1>任务</h1>
                        <p>直接创建任务，或让助理安排。</p>
                    </div>
                    <div class="task-heading-actions">
                        <button class="task-action" :disabled="tasks.loading || !ws.authenticated" @click="tasks.load()">{{ tasks.loading ? '刷新中…' : '刷新' }}</button>
                        <button class="task-primary" @click="showCreate = true">新建任务</button>
                    </div>
                </div>

                <div class="task-filters" aria-label="任务状态">
                    <button v-for="item in filters" :key="item.id" :aria-pressed="filter === item.id"
                        :class="{ selected: filter === item.id }" @click="filter = item.id">
                        {{ item.label }}<span>{{ tasks.tasks.filter(item.match).length }}</span>
                    </button>
                </div>

                <div v-if="tasks.loadError" class="task-error" role="alert">{{ tasks.loadError }}</div>
                <div v-if="!visibleTasks.length" class="task-empty">
                    <template v-if="tasks.loading && !tasks.tasks.length">正在加载任务…</template>
                    <template v-else>
                        <h2>{{ tasks.tasks.length ? '没有这个状态的任务' : '还没有任务' }}</h2>
                        <p>直接创建任务并发消息，也可以让助理安排。</p>
                        <div class="task-heading-actions">
                            <button class="task-primary" @click="showCreate = true">新建任务</button>
                            <button class="task-action" @click="router.push('/assistant')">让助理安排</button>
                        </div>
                    </template>
                </div>

                <div v-else class="task-cards">
                    <article v-for="task in visibleTasks" :key="task.id" class="task-card">
                        <button class="task-card-main" @click="router.push({ name: 'tasks', params: { id: task.id } })">
                            <div class="task-card-top">
                                <span class="task-status" :class="tone(task)"><i></i>{{ STATUS_TEXT[task.status] || task.status }}</span>
                                <time>{{ updatedAt(task) }}</time>
                            </div>
                            <h2>{{ task.title || '未命名任务' }}</h2>
                            <p class="task-progress">{{ task.progress || '等待任务汇报进度' }}</p>
                            <div class="task-card-meta">
                                <span>{{ deviceName(task) }}</span>
                                <span v-if="task.steps">{{ task.steps }} 步</span>
                                <span v-if="task.cost">${{ task.cost.toFixed(3) }}</span>
                            </div>
                        </button>
                        <div class="task-card-actions">
                            <button @click="router.push({ name: 'tasks', params: { id: task.id } })">查看任务 →</button>
                            <button v-if="isOpen(task)" :disabled="!ws.showActions" @click="cancel(task)">停止</button>
                            <button v-else class="task-delete" :disabled="!ws.showActions" @click="remove(task)">删除</button>
                        </div>
                    </article>
                </div>
            </div>
        </main>
        <NewTaskModal :open="showCreate" @close="showCreate = false" @created="created" />
    </div>
</template>

<style scoped>
.tasks-app { background: var(--color-bg); }
.task-list-scroll { min-height: 0; flex: 1; overflow-y: auto; }
.task-list-inner { max-width: 1000px; margin: 0 auto; padding: 28px 20px max(env(safe-area-inset-bottom), 28px); }
.task-list-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.task-list-heading > div:first-child { min-width: 0; }
.task-heading-actions { display: flex; flex-shrink: 0; align-items: center; gap: 8px; }
.task-heading-actions .task-primary { margin-top: 0; }
.task-list-heading h1 { font-family: var(--font-serif); font-size: 26px; font-weight: 700; color: var(--color-ink); }
.task-list-heading p { margin-top: 5px; font-size: 13px; color: var(--color-muted); }
.task-action, .task-primary { padding: 8px 14px; border: 1px solid var(--color-line-hi); border-radius: 8px; font-size: 13px; white-space: nowrap; }
.task-action { color: var(--color-ink); background: var(--color-bg-elev); }
button:disabled { opacity: .4; cursor: not-allowed; }
.task-filters { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 18px; }
.task-filters button { display: flex; align-items: center; gap: 7px; flex-shrink: 0; padding: 8px 12px; border-radius: 8px; font-size: 12px; color: var(--color-muted); }
.task-filters button.selected { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
.task-filters span { font-size: 11px; opacity: .7; }
.task-error { padding: 12px; margin-bottom: 16px; border: 1px solid var(--color-bad); border-radius: 8px; color: var(--color-bad); font-size: 13px; }
.task-empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 64px 20px; color: var(--color-muted); text-align: center; font-size: 13px; }
.task-empty h2 { font-size: 17px; color: var(--color-ink); }
.task-primary { margin-top: 4px; border-color: transparent; color: var(--color-bg); background: var(--color-accent); }
.task-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.task-card { display: flex; min-width: 0; flex-direction: column; border: 1px solid var(--color-line); border-radius: 12px; background: var(--color-bg-elev); overflow: hidden; }
.task-card:hover { border-color: var(--color-line-hi); }
.task-card-main { flex: 1; width: 100%; padding: 18px; text-align: left; }
.task-card-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.task-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-muted); }
.task-status i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.task-status.live { color: var(--color-accent); }
.task-status.warn, .task-status.bad { color: var(--color-bad); }
.task-card time { font-size: 11px; color: var(--color-faint); }
.task-card h2 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; margin: 15px 0 10px; line-height: 1.6; font-size: 14px; font-weight: 500; color: var(--color-ink); overflow-wrap: anywhere; }
.task-progress { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; min-height: 38px; font-size: 12px; line-height: 1.6; color: var(--color-muted); overflow-wrap: anywhere; }
.task-card-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; color: var(--color-faint); font-size: 11px; }
.task-card-actions { display: flex; justify-content: space-between; gap: 12px; padding: 10px 18px; border-top: 1px solid var(--color-line); font-size: 12px; color: var(--color-muted); }
.task-card-actions button:hover { color: var(--color-ink); }
.task-card-actions .task-delete:hover { color: var(--color-bad); }
@media (max-width: 600px) {
    .task-cards { grid-template-columns: minmax(0, 1fr); }
    .task-list-inner { padding: 22px 14px max(env(safe-area-inset-bottom), 22px); }
    .task-filters button { padding: 8px 10px; }
}
</style>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useViewStore } from '@/stores/view';
import { useAssistantStore, useTaskAgentStore } from '@/stores/agent';
import { useTerminalStore } from '@/stores/terminal';
import { useTasksStore } from '@/stores/tasks';
import DevicePicker from '@/components/DevicePicker.vue';
import TaskTitle from '@/components/tasks/TaskTitle.vue';

const view = useViewStore();
const assistant = useAssistantStore();
const term = useTerminalStore();
const tasks = useTasksStore();
const route = useRoute();
const router = useRouter();
const taskAgent = useTaskAgentStore();
const taskDetail = computed(() => route.name === 'tasks' && Boolean(route.params.id));
const currentTask = computed(() => tasks.tasks.find((item) => item.id === route.params.id)
    || (taskAgent.currentTask?.id === route.params.id ? taskAgent.currentTask : null));

const app = computed(() => view.appOf(route.path));
// 设备选择只给对着某一台设备操作的页面；助理和设置不看它，不显示免得误导。
const deviceScoped = computed(() => ['terminal', 'files', 'screen', 'status'].includes(route.name));

// 有侧栏的应用把「当前打开的东西」放在标题上，其余显示应用名
const title = computed(() => {
    if (taskDetail.value) return '任务详情';
    if (route.name === 'terminal') {
        const tab = term.terminalTabs.find((item) => item.id === term.activeTerminalId);
        return tab ? term.terminalTitle(tab) : '终端';
    }
    return app.value?.label || '';
});
</script>

<template>
    <header class="safe-top relative z-40 shrink-0 flex items-center gap-2 px-2 py-2 bg-zinc-900/80 backdrop-blur border-b border-zinc-800">
        <button v-if="taskDetail" @click="router.push('/tasks')" aria-label="返回任务列表"
            class="shrink-0 w-9 h-9 flex items-center justify-center text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <button v-if="app?.side"
            @click="view.openSide"
            class="shrink-0 w-9 h-9 flex items-center justify-center text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            title="菜单">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>

        <div class="min-w-0 flex-1" :class="{ 'pl-2': !app?.side && !taskDetail }">
            <TaskTitle v-if="taskDetail && currentTask" :task="currentTask" />
            <div v-else class="truncate font-serif font-bold text-[15px] tracking-tight text-zinc-100">{{ title }}</div>
        </div>

        <DevicePicker v-if="deviceScoped" class="shrink-0" />

        <button
            @click="view.toggleApps"
            class="relative shrink-0 w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
            :class="view.showApps ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800'"
            :title="assistant.unread ? '应用 · 助理有新汇报' : '应用'">
            <span v-if="assistant.unread" class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent"></span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
                <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                <circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
            </svg>
        </button>
    </header>
</template>

// 助理派出去的任务：列表、状态、进度。
// 任务本身是会话（id 就是会话 id），点开看细节走 agent.openTask；这里只管控制面那点热点数据。
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useTaskAgentStore } from '@/stores/agent';
import { useAgentClientStore } from '@/stores/agent-client';
import { useToastStore } from '@/stores/toast';
import { useWsStore } from '@/stores/ws';

export const OPEN_STATES = ['queued', 'running', 'needs_human'];

export const STATUS_TEXT = {
    queued: '排队中',
    running: '执行中',
    needs_human: '等人决定',
    done: '已完成',
    failed: '失败',
    cancelled: '已取消',
    interrupted: '被中断',
};

export const isOpen = (task) => OPEN_STATES.includes(task?.status);

export const useTasksStore = defineStore('tasks', () => {
    const client = useAgentClientStore();
    const ws = useWsStore();
    const toastStore = useToastStore();
    const toast = (text) => toastStore.show(text, 2400);
    const tasks = ref([]);
    const loading = ref(false);
    const loadError = ref('');
    let refreshTimer;
    let loadSequence = 0;

    function edit(id, fields) {
        tasks.value = tasks.value.map((task) => (task.id === id ? { ...task, ...fields } : task));
    }

    async function load() {
        const mine = ++loadSequence;
        loading.value = true;
        try {
            const data = await client.request('tasks.list', { limit: 200 });
            if (mine !== loadSequence) return false;
            tasks.value = data.tasks;
            loadError.value = '';
            return true;
        } catch (error) {
            if (mine === loadSequence) loadError.value = error.message || '任务加载失败';
            return false;
        } finally {
            if (mine === loadSequence) loading.value = false;
        }
    }

    // 会话事件只带会话 id 和流式内容，进度到不了这里：任务开始 / 结束就重新拉一次列表。
    client.onEvent((event) => {
        const task = tasks.value.find((entry) => entry.id === event.session_id);
        if (task && event.type === 'done') edit(task.id, { running: false });
        if (event.type === 'done' || event.type === 'function_call_output') {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => { if (ws.showActions) void load(); }, 150);
        }
        if (task && !task.running && ['message', 'reasoning', 'function_call'].includes(event.type)) {
            edit(task.id, { running: true, status: 'running', open: true });
        }
    });

    async function open(task) {
        const agent = useTaskAgentStore();
        agent.init();
        await agent.openTask(task);
    }

    // 手动创建和助理派发走同一执行链，结束后也由后端通知助理。
    async function create(args) {
        const result = await client.request('tasks.dispatch', args, 60000);
        await load();
        return result.task_id;
    }

    async function rename(task, title) {
        const data = await client.request('tasks.patch', { id: task.id, title });
        edit(task.id, data.task);
        const agent = useTaskAgentStore();
        if (agent.currentTask?.id === task.id) agent.currentTask = data.task;
        await load();
        return data.task;
    }

    // 任务会话里发话就是追加指令；从列表里也能直接改。
    async function steer(task, text) {
        const content = String(text || '').trim();
        if (!content) return false;
        try {
            await client.request('tasks.steer', { id: task.id, text: content }, 60000);
            edit(task.id, { status: 'running', running: true, open: true });
            return true;
        } catch (error) {
            toast(error.message || '追加指令失败');
            return false;
        }
    }

    async function cancel(task) {
        try {
            await client.request('tasks.cancel', { id: task.id }, 60000);
            edit(task.id, { status: 'cancelled', running: false, open: false });
            return true;
        } catch (error) {
            toast(error.message || '停止失败');
            return false;
        }
    }

    async function remove(task) {
        try {
            await client.request('sessions.delete', { id: task.id });
            tasks.value = tasks.value.filter((entry) => entry.id !== task.id);
            const agent = useTaskAgentStore();
            if (agent.currentTask?.id === task.id) agent.clearTask();
            return true;
        } catch (error) {
            toast(error.message || '删除失败');
            return false;
        }
    }

    // 连上（含重连）就拉一次，补上断线期间结束的任务。
    let started = false;
    function init() {
        if (started) return;
        started = true;
        watch(() => ws.showActions, (online) => { if (online) void load(); }, { immediate: true });
    }

    return { tasks, loading, loadError, init, load, create, rename, open, steer, cancel, remove };
});

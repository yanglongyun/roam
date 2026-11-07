// 助理的会话状态。移植自 agentic 的 thread/store.ts：
// 操作经 HTTP 发给 Worker（助理跑在云端），回复过程经 WS agent.event 推来。
import { defineStore } from 'pinia';
import { ref, toRef, watch } from 'vue';
import { useWsStore } from '@/stores/ws';
import { useToastStore } from '@/stores/toast';
import { useAgentClientStore } from '@/stores/agent-client';
import { mergeMessages, itemText } from '@/lib/agent/thread';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const conversationStore = (storeId, kind) => defineStore(storeId, () => {
    const ws = useWsStore();
    const client = useAgentClientStore();
    const { request, onEvent } = client;
    const toastStore = useToastStore();
    const toast = (text) => toastStore.show(text, 2400);

    // 常驻助理的 id 是固定的，加载期间输入的草稿也要落到同一个会话。
    const currentId = ref(kind === 'assistant' ? 'router' : '');
    // 输入草稿按会话保存，离开应用或返回任务列表后再打开也不会串到别的会话。
    const drafts = ref({});
    const status = toRef(client, 'status');
    const messages = ref([]);
    const compactions = ref([]);
    const notes = ref([]);
    const expanded = ref({});
    /** 当前会话正在回复。 */
    const busy = ref(false);
    const stopping = ref(false);
    const unread = ref(0);
    let visible = false;
    function setVisible(value) {
        visible = value;
        if (value) unread.value = 0;
    }
    /** 本轮最近一次 error 事件的说明，done 时显示。 */
    const lastError = ref('');
    const ready = ref(false);
    /** 当前打开的是任务会话时，这里放那个任务（见 stores/tasks.js）。 */
    const currentTask = ref(null);
    const loadError = ref('');
    const viewSeq = ref(0);
    const hasMore = ref(false);
    const loadingOlder = ref(false);
    let generation = 0;
    let openingEvents = null;

    onEvent(receiveEvent);

    /* ── 图片：消息里是 /api/images/<文件名>，从云端取回，缓存成 blob 地址 ── */

    const imageCache = new Map();
    function imageSrc(url) {
        if (!String(url).startsWith('/api/images/')) return Promise.resolve(url);
        if (!imageCache.has(url)) {
            const loading = request('images.get', { url }, 60000).then((image) => {
                const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
                return URL.createObjectURL(new Blob([bytes], { type: image.type }));
            });
            loading.catch(() => imageCache.delete(url));
            imageCache.set(url, loading);
        }
        return imageCache.get(url);
    }

    /* ── 消息 ── */

    function noteFor(doneStatus, error) {
        if (doneStatus === 'aborted') return [{ key: uuid(), kind: 'system', code: 'stopped' }];
        if (doneStatus === 'incomplete') return [{ key: uuid(), kind: 'system', code: 'error', content: error || '回复未完成' }];
        return [];
    }
    // 已存库的按 ID 排序；还没有 ID 的（流式、发送中）留在最后。
    function inOrder(list) {
        const saved = list.filter((entry) => entry.id > 0).sort((a, b) => a.id - b.id);
        return [...saved, ...list.filter((entry) => entry.id === 0)];
    }
    // 收到一个完整 item：按数据库 ID 合并。流式行和发送中的用户消息由它接替，保留原来的 key。
    function addItem(item, id, createdAt, metadata = {}) {
        const pendingForItem = (entry) => (entry.streaming && entry.item.type === item.type
            && (item.type !== 'message' || entry.item.role === item.role))
            || (entry.sending && item.type === 'message' && item.role === 'user');
        if (messages.value.some((entry) => entry.id === id)) {
            // HTTP 可能已包含这条完整消息，WS 完成事件仍需清掉对应流式占位。
            if (!metadata.notification_id) messages.value = messages.value.filter((entry) => !pendingForItem(entry));
            return;
        }
        const index = metadata.notification_id ? -1 : messages.value.findIndex(pendingForItem);
        const row = { id, item, created_at: createdAt, ...metadata };
        if (index < 0) {
            messages.value = inOrder([...messages.value, row]);
            return;
        }
        const next = [...messages.value];
        next[index] = { ...row, key: next[index].key };
        messages.value = inOrder(next);
    }
    function streamingItem(type, text) {
        if (type === 'message') return { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
        return { type: 'reasoning', summary: [{ type: 'summary_text', text }] };
    }
    function addDelta(type, delta) {
        const index = messages.value.findIndex((entry) => entry.streaming && entry.item.type === type);
        if (index >= 0) {
            const next = [...messages.value];
            next[index] = { ...next[index], item: streamingItem(type, itemText(next[index].item) + delta) };
            messages.value = next;
            return;
        }
        messages.value = [...messages.value, { id: 0, key: uuid(), item: streamingItem(type, delta), streaming: true, created_at: Date.now() }];
    }

    function receiveEvent(event) {
        if (kind === 'assistant' && event.session_id === 'router' && event.type === 'task_report') {
            if (!visible && event.status === 'completed') {
                unread.value++;
                toast('助理有新的任务汇报');
            }
            return;
        }
        if (event.session_id !== currentId.value) return;
        if (openingEvents) { openingEvents.push(event); return; }
        switch (event.type) {
            case 'message':
            case 'reasoning':
                if (event.item) addItem(event.item, event.id, event.created_at, {
                    ...(event.notification_id ? {
                        notification_id: event.notification_id, task_id: event.task_id,
                        task_status: event.task_status, task_title: event.task_title,
                    } : {}),
                });
                else addDelta(event.type, event.delta);
                busy.value = true;
                return;
            case 'function_call':
            case 'function_call_output':
                addItem(event.item, event.id, event.created_at);
                return;
            case 'compact':
                if (event.status === 'started') {
                    toast('正在压缩上下文…');
                    return;
                }
                compactions.value = [...compactions.value.filter((entry) => entry.id !== event.id), {
                    id: event.id, message_id: event.message_id, summary: event.summary, created_at: event.created_at,
                }];
                return;
            case 'usage': {
                // 电脑端把 usage 写在这次响应最后存下的那条上，这里同样挂到最后一条已存的消息。
                if (!event.usage) return;
                let index = event.message_id ? messages.value.findIndex((entry) => entry.id === event.message_id) : messages.value.length - 1;
                while (index >= 0 && messages.value[index].id === 0) index--;
                if (index < 0) return;
                const next = [...messages.value];
                next[index] = { ...next[index], usage: event.usage, cost: event.cost || next[index].cost };
                messages.value = next;
                return;
            }
            case 'retry':
                toast(`请求失败，${event.delayMs / 1000} 秒后重试（${event.attempt}/${event.maxRetries}）`);
                return;
            case 'error':
                lastError.value = event.error;
                return;
            case 'done':
                messages.value = messages.value.filter((entry) => !entry.streaming);
                notes.value = noteFor(event.status, lastError.value);
                lastError.value = '';
                busy.value = false;
                stopping.value = false;
                return;
        }
    }

    function reset() {
        generation++;
        openingEvents = null;
        messages.value = [];
        compactions.value = [];
        notes.value = [];
        expanded.value = {};
        busy.value = false;
        stopping.value = false;
        lastError.value = '';
        ready.value = false;
        loadError.value = '';
        hasMore.value = false;
        loadingOlder.value = false;
    }

    async function loadStatus() {
        try {
            await client.loadStatus();
            return true;
        } catch (error) {
            toast(error.message || '状态加载失败');
            return false;
        }
    }
    // 打开对话：一次拿到消息、压缩记录，以及正在运行时已输出的流式文字。
    async function openThread(id, force = false) {
        if (!id || (!force && currentId.value === id && (ready.value || busy.value))) return;
        if (currentTask.value && currentTask.value.id !== id) currentTask.value = null;
        reset();
        currentId.value = id;
        const mine = generation;
        const buffered = [];
        openingEvents = buffered;
        try {
            const opened = await request('sessions.open', { id });
            if (generation !== mine) return;
            const streaming = [];
            if (opened.streaming?.reasoning) {
                streaming.push({ id: 0, key: uuid(), item: streamingItem('reasoning', opened.streaming.reasoning), streaming: true });
            }
            if (opened.streaming?.text) {
                streaming.push({ id: 0, key: uuid(), item: streamingItem('message', opened.streaming.text), streaming: true });
            }
            // 请求期间已经推来的完整 item 按 ID 合并，不会丢也不会重复。
            messages.value = [...mergeMessages(opened.messages, messages.value.filter((entry) => entry.id > 0)), ...streaming];
            compactions.value = opened.compactions;
            hasMore.value = opened.has_more;
            busy.value = opened.running;
            openingEvents = null;
            for (const event of buffered) {
                const cursor = opened.event_cursor;
                if (!cursor || !event.event_cursor || event.event_cursor.epoch !== cursor.epoch || event.event_cursor.sequence > cursor.sequence) receiveEvent(event);
            }
            ready.value = true;
            viewSeq.value++;
        } catch (error) {
            if (generation === mine) {
                openingEvents = null;
                for (const event of buffered) receiveEvent(event);
                loadError.value = error.message || '记录加载失败';
            }
        }
    }
    // 打开一个任务：先标成任务模式，再按会话把它打开（任务就是一个会话）。
    function openTask(task) {
        currentTask.value = task;
        return openThread(task.id, true);
    }
    function clearTask() {
        currentTask.value = null;
        reset();
        currentId.value = '';
        viewSeq.value++;
    }
    async function loadOlder() {
        if (!currentId.value || !hasMore.value || loadingOlder.value || !messages.value.length) return;
        const mine = generation;
        loadingOlder.value = true;
        try {
            const page = await request('messages.list', { id: currentId.value, limit: 60, before: messages.value[0].id });
            if (generation === mine) {
                messages.value = [...mergeMessages(page.messages, messages.value.filter((entry) => entry.id > 0)),
                    ...messages.value.filter((entry) => entry.id === 0)];
                hasMore.value = page.has_more;
                return true;
            }
        } catch (error) {
            toast(error.message || '历史消息加载失败');
            return false;
        } finally {
            if (generation === mine) loadingOlder.value = false;
        }
    }

    function send(text, retryRow = null, images = []) {
        const content = text.trim();
        // 任务会话里发话 = 给它追加指令，任务正在跑也允许。
        const steering = Boolean(currentTask.value);
        if ((!content && images.length === 0) || !ready.value || !currentId.value) return false;
        if (busy.value && !steering) return false;
        if (images.length > 5) {
            toast('每条消息最多发送 5 张图片');
            return false;
        }
        if (!status.value?.model_ready) {
            toast('请先在设置中配置模型');
            return false;
        }
        const key = retryRow?.key || uuid();
        const item = { type: 'message', role: 'user', content: [] };
        if (content) item.content.push({ type: 'input_text', text: content });
        for (const image of images) item.content.push({ type: 'input_image', image_url: image, detail: 'auto' });
        const user = { id: 0, key, item, created_at: Date.now(), sending: true };
        messages.value = [...messages.value.filter((entry) => entry.key !== key), user];
        notes.value = [];
        busy.value = true;
        viewSeq.value++;
        void submit(content, images, user, generation);
        return true;
    }
    async function submit(text, images, user, mine) {
        let id = currentId.value;
        try {
            const uploaded = [];
            for (const image of images) {
                if (image.startsWith('/api/images/')) uploaded.push(image);
                else uploaded.push((await request('images.upload', { id, image }, 60000)).url);
            }
            if (generation !== mine) return;
            const saved = await request('messages.send', { id, text, images: uploaded }, 60000);
            // 给任务追加指令时后端返回的是任务信息，消息本身由事件补进来。
            if (generation === mine && saved.id) addItem(user.item, saved.id, saved.created_at);
        } catch (error) {
            if (generation !== mine) return;
            toast(error.message || '发送失败');
            messages.value = [
                ...messages.value.filter((entry) => entry.key !== user.key),
                { ...user, sending: false, failed: true },
            ];
            busy.value = false;
            stopping.value = false;
        }
    }
    const retrySend = (row) => (row.failed ? send(row.content || '', row, row.images) : false);

    // 停止：等电脑端真正停下才返回，结束状态由随后的 done 事件更新。
    async function stopRun() {
        if (!busy.value || !currentId.value) return;
        stopping.value = true;
        try {
            await request('run.stop', { id: currentId.value }, 60000);
        } catch (error) {
            stopping.value = false;
            toast(error.message || '停止失败');
        }
    }
    // 每次连上（包括重连）都重新拉取，补上断线期间错过的事件。
    let started = false;
    function init() {
        if (started) return;
        started = true;
        watch(() => [ws.authenticated, ws.showActions], async ([authed, live], previous) => {
            // 已登录但实时通道断开时可以首次读取；断开瞬间保留已展示内容，重连再补快照。
            if (!authed || (!live && previous?.[0])) return;
            void loadStatus();
            if (kind === 'assistant') {
                try {
                    const opened = await request('router.open');
                    if (ws.showActions) await openThread(opened.id, true);
                } catch (error) {
                    loadError.value = error.message || '助理加载失败';
                }
            } else if (currentId.value) {
                void openThread(currentId.value, true);
            }
        }, { immediate: true });
    }

    return {
        kind,
        currentId, currentTask, drafts, status, messages, compactions, notes,
        expanded, busy, stopping, unread, setVisible, ready, loadError, viewSeq, hasMore, loadingOlder,
        init, imageSrc, request, onEvent, openTask, loadStatus, openThread, clearTask, loadOlder,
        send, retrySend, stopRun,
    };
});

export const useAssistantStore = conversationStore('assistant', 'assistant');
export const useTaskAgentStore = conversationStore('task-agent', 'task');

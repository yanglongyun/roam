// 助理的会话状态。移植自 agentic 的 thread/store.ts：
// 操作经 agent.request 发给 Worker（助理跑在云端），等 agent.result；回复过程经 agent.event 推来。
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useWsStore } from '@/stores/ws';
import { useToastStore } from '@/stores/toast';
import { mergeMessages, itemText } from '@/lib/agent/thread';

export const threadTitle = (thread) => thread?.title || thread?.preview || '对话';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const useAgentStore = defineStore('agent', () => {
    const ws = useWsStore();
    const toastStore = useToastStore();
    const toast = (text) => toastStore.show(text, 2400);

    const threads = ref([]);
    /** 列表还有更早的未置顶对话没加载。 */
    const threadsMore = ref(false);
    const loadingThreads = ref(false);
    /** 置顶组的顺序（会话 ID），存在云端。 */
    const pinOrder = ref([]);
    const currentId = ref('');
    const status = ref(null);
    const messages = ref([]);
    const compactions = ref([]);
    const notes = ref([]);
    const expanded = ref({});
    /** 当前会话正在回复。 */
    const busy = ref(false);
    const stopping = ref(false);
    /** 本轮最近一次 error 事件的说明，done 时显示。 */
    const lastError = ref('');
    const ready = ref(false);
    const loadError = ref('');
    const viewSeq = ref(0);
    const hasMore = ref(false);
    const loadingOlder = ref(false);
    let generation = 0;

    /* ── 请求：agent.request → agent.result ── */

    const pending = new Map();
    let seq = 0;

    function request(op, args = {}, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const reqId = `a${Date.now().toString(36)}_${seq++}`;
            const timer = setTimeout(() => {
                pending.delete(reqId);
                reject(new Error('云端没有响应'));
            }, timeoutMs);
            pending.set(reqId, { resolve, reject, timer });
            const sent = ws.sendMsg({ type: 'agent.request', to: 'desktop', data: { reqId, op, args } });
            if (!sent) {
                clearTimeout(timer);
                pending.delete(reqId);
                reject(new Error('未连接云端'));
            }
        });
    }

    ws.onMessage('agent.result', (msg) => {
        const d = msg.data || {};
        const entry = pending.get(d.reqId);
        if (!entry) return;
        pending.delete(d.reqId);
        clearTimeout(entry.timer);
        if (d.ok) entry.resolve(d.data);
        else entry.reject(new Error(d.error || '操作失败'));
    });
    ws.onMessage('agent.event', (msg) => receiveEvent(msg.data || {}));

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

    /* ── 列表 ── */

    // 列表只由列表操作加载。其他地方只改某一行自己动过的字段，不拿别的操作返回的数据整行替换。
    function editThread(id, fields) {
        threads.value = threads.value
            .map((thread) => (thread.id === id ? { ...thread, ...fields } : thread))
            .sort((a, b) => b.updated_at - a.updated_at);
    }
    // 事件只带会话 ID，列表里的运行状态、更新时间和预览从事件推出来。
    // 流式增量、用量这类事件不改变列表，直接跳过。
    function touchThread(event) {
        const thread = threads.value.find((entry) => entry.id === event.session_id);
        if (!thread) return;
        const running = event.type !== 'done';
        let savedAt = 0;
        if (event.item) savedAt = event.created_at;
        if (thread.running === running && !savedAt) return;
        const fields = { running };
        if (savedAt) fields.updated_at = savedAt;
        if (event.type === 'message' && event.item?.role === 'user' && !thread.preview) {
            fields.preview = itemText(event.item).replace(/\s+/g, ' ').slice(0, 60) || '[图片]';
        }
        editThread(thread.id, fields);
    }
    function dropThread(id) {
        threads.value = threads.value.filter((thread) => thread.id !== id);
        pinOrder.value = pinOrder.value.filter((entry) => entry !== id);
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
    function addItem(item, id, createdAt) {
        if (messages.value.some((entry) => entry.id === id)) return;
        const index = messages.value.findIndex(
            (entry) => (entry.streaming && entry.item.type === item.type)
                || (entry.sending && item.type === 'message' && item.role === 'user'),
        );
        const row = { id, item, created_at: createdAt };
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
        touchThread(event);
        if (event.session_id !== currentId.value) return;
        switch (event.type) {
            case 'message':
            case 'reasoning':
                if (event.item) addItem(event.item, event.id, event.created_at);
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
                compactions.value = [...compactions.value, {
                    id: event.id, message_id: event.message_id, summary: event.summary, created_at: event.created_at,
                }];
                return;
            case 'usage': {
                // 电脑端把 usage 写在这次响应最后存下的那条上，这里同样挂到最后一条已存的消息。
                if (!event.usage) return;
                let index = messages.value.length - 1;
                while (index >= 0 && messages.value[index].id === 0) index--;
                if (index < 0) return;
                const next = [...messages.value];
                next[index] = { ...next[index], usage: event.usage };
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
            status.value = await request('status.get');
            return true;
        } catch (error) {
            toast(error.message || '状态加载失败');
            return false;
        }
    }
    // 第一页：全部置顶对话加最近更新的 50 个。
    async function loadThreads() {
        try {
            const data = await request('sessions.list');
            threads.value = data.sessions;
            threadsMore.value = data.has_more;
            pinOrder.value = data.sessions.filter((thread) => thread.pinned).map((thread) => thread.id);
            return true;
        } catch (error) {
            toast(error.message || '会话列表加载失败');
            return false;
        }
    }
    // 列表滚到底时接着加载更早的未置顶对话，以已加载的最后一个为起点。
    async function loadMoreThreads() {
        const last = threads.value.filter((thread) => !thread.pinned).at(-1);
        if (!threadsMore.value || loadingThreads.value || !last) return;
        loadingThreads.value = true;
        try {
            const data = await request('sessions.list', { before: last.updated_at, before_id: last.id });
            threads.value = [
                ...threads.value,
                ...data.sessions.filter((thread) => !threads.value.some((entry) => entry.id === thread.id)),
            ];
            threadsMore.value = data.has_more;
        } catch (error) {
            toast(error.message || '会话列表加载失败');
        } finally {
            loadingThreads.value = false;
        }
    }

    // 打开对话：一次拿到消息、压缩记录，以及正在运行时已输出的流式文字。
    async function openThread(id, force = false) {
        if (!id || (!force && currentId.value === id && (ready.value || busy.value))) return;
        reset();
        currentId.value = id;
        const mine = generation;
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
            ready.value = true;
            viewSeq.value++;
        } catch (error) {
            if (generation === mine) loadError.value = error.message || '对话加载失败';
        }
    }
    function createDraft() {
        reset();
        currentId.value = '';
        ready.value = true;
        viewSeq.value++;
    }
    async function loadOlder() {
        if (!currentId.value || !hasMore.value || loadingOlder.value || busy.value) return;
        const mine = generation;
        loadingOlder.value = true;
        try {
            const page = await request('messages.list', { id: currentId.value, limit: 60, before: messages.value[0].id });
            if (generation === mine) {
                messages.value = mergeMessages(page.messages, messages.value);
                hasMore.value = page.has_more;
            }
        } catch (error) {
            toast(error.message || '历史消息加载失败');
        } finally {
            if (generation === mine) loadingOlder.value = false;
        }
    }

    function send(text, retryRow = null, images = []) {
        const content = text.trim();
        if ((!content && images.length === 0) || busy.value || !ready.value) return false;
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
            if (!id) {
                const session = await request('sessions.create');
                if (generation !== mine) return;
                id = session.id;
                currentId.value = session.id;
                threads.value = [session, ...threads.value];
            }
            const uploaded = [];
            for (const image of images) {
                if (image.startsWith('/api/images/')) uploaded.push(image);
                else uploaded.push((await request('images.upload', { id, image }, 60000)).url);
            }
            if (generation !== mine) return;
            const saved = await request('messages.send', { id, text, images: uploaded });
            if (generation === mine) addItem(user.item, saved.id, saved.created_at);
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
    async function renameThread(id, title) {
        try {
            await request('sessions.patch', { id, title });
            editThread(id, { title });
        } catch (error) {
            toast(error.message || '重命名失败');
        }
    }
    async function removeThread(id) {
        try {
            await request('sessions.delete', { id });
            dropThread(id);
            if (currentId.value === id) createDraft();
            return true;
        } catch (error) {
            toast(error.message || '删除失败');
            return false;
        }
    }
    async function pinThread(id, pinned) {
        try {
            await request('sessions.patch', { id, pinned });
            editThread(id, { pinned });
            // 新置顶的排在置顶组最前，与电脑端一致；取消置顶就移出。
            pinOrder.value = pinned
                ? [id, ...pinOrder.value.filter((entry) => entry !== id)]
                : pinOrder.value.filter((entry) => entry !== id);
        } catch (error) {
            toast(error.message || '置顶失败');
        }
    }
    // 拖拽结束后保存置顶组的完整顺序；失败时以电脑端为准重新加载。
    async function reorderPins(ids) {
        const previous = pinOrder.value;
        pinOrder.value = ids;
        try {
            await request('sessions.pins', { ids });
        } catch (error) {
            pinOrder.value = previous;
            toast(error.message || '排序保存失败');
            void loadThreads();
        }
    }

    /* ── 设置 ── */

    const getConfig = () => request('config.get');
    async function saveConfig(patch) {
        await request('config.put', patch);
        await loadStatus();
    }

    // 每次连上（包括重连）都重新拉取，补上断线期间错过的事件。
    let started = false;
    function init() {
        if (started) return;
        started = true;
        if (!currentId.value) createDraft();
        watch(() => ws.showActions, (online) => {
            if (!online) return;
            void loadStatus();
            void loadThreads();
            if (currentId.value) void openThread(currentId.value, true);
        }, { immediate: true });
    }

    return {
        threads, threadsMore, loadingThreads, pinOrder, currentId, status, messages, compactions, notes,
        expanded, busy, stopping, ready, loadError, viewSeq, hasMore, loadingOlder,
        init, imageSrc, loadStatus, loadThreads, loadMoreThreads, openThread, createDraft, loadOlder,
        send, retrySend, stopRun, renameThread, removeThread, pinThread, reorderPins, getConfig, saveConfig,
    };
});

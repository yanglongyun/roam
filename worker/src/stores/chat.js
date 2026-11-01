import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useWsStore } from '@/stores/ws';
import { mkKey, renderMessages } from '@/lib/chat/messages';
import { setupChatStream } from '@/lib/chat/stream';

const PAGE = 50; // 每页消息条数

export const useChatStore = defineStore('chat', () => {
    const ws = useWsStore();

    const conversations = ref([]);
    const currentId = ref('');
    const currentTitle = ref('');
    const messages = ref([]);
    const busy = ref(false);
    const ready = ref(false);
    const streamTick = ref(0);   // 流式增量：让视图“跟随到底”（仅当已在底部）
    const viewSeq = ref(0);      // 打开/新建/发送：强制滚到底
    const hasMore = ref(false);  // 还有更早的消息可加载
    const loadingOlder = ref(false);

    const pending = new Map();
    let seq = 0;
    let bound = false;
    let stream = null;
    let oldestIndex = 0;         // 已加载到的最早消息在原始数组里的下标（分页游标）

    function request(type, data = {}) {
        return new Promise((resolve) => {
            const reqId = `r${Date.now()}_${seq++}`;
            pending.set(reqId, resolve);
            const ok = ws.sendMsg({ type, to: 'desktop', data: { ...data, reqId } });
            if (!ok) { pending.delete(reqId); resolve(null); return; }
            setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); resolve(null); } }, 20000);
        });
    }
    function onResult(msg) {
        const d = msg.data || {};
        const r = d.reqId && pending.get(d.reqId);
        if (r) { pending.delete(d.reqId); r(d); }
    }

    function pushRow(row) {
        messages.value.push(row);
        return messages.value[messages.value.length - 1];
    }
    function bumpStream() {
        streamTick.value++;
    }

    function bind() {
        if (bound) return;
        bound = true;
        stream = setupChatStream({
            messages,
            currentId,
            currentTitle,
            conversations,
            busy,
            pushRow,
            refresh,
            bumpStream,
        });
        ['ai.list.result', 'ai.create.result', 'ai.get.result', 'ai.rename.result', 'ai.delete.result', 'ai.abort.result', 'ai.error']
            .forEach((t) => ws.onMessage(t, onResult));
        ws.onMessage('ai.event', (msg) => stream.onEvent(msg.data || {}));
        ws.onMessage('ai.screenshot', (msg) => {
            const d = msg.data || {};
            if (!d.dataUrl) return;
            pushRow({ type: 'shot', _key: mkKey('shot'), dataUrl: d.dataUrl, at: d.at });
            bumpStream();
        });
    }

    async function refresh() {
        const d = await request('ai.list');
        if (d) { conversations.value = d.conversations || []; ready.value = true; }
    }
    async function openChat(id) {
        currentId.value = id;
        stream?.resetStreaming();
        const d = await request('ai.get', { chatId: id, limit: PAGE });
        messages.value = renderMessages(d?.messages || []);
        currentTitle.value = d?.conversation?.title || '';
        busy.value = d?.conversation?.state === 'running';
        oldestIndex = d?.firstIndex ?? 0;
        hasMore.value = Boolean(d?.hasMore);
        viewSeq.value++; // 打开会话 → 强制滚到底
    }
    async function loadOlder() {
        if (!currentId.value || !hasMore.value || loadingOlder.value) return 0;
        loadingOlder.value = true;
        const d = await request('ai.get', { chatId: currentId.value, limit: PAGE, before: oldestIndex });
        loadingOlder.value = false;
        if (!d) return 0;
        const older = renderMessages(d.messages || []);
        if (older.length) messages.value.unshift(...older);
        oldestIndex = d.firstIndex ?? 0;
        hasMore.value = Boolean(d.hasMore);
        return older.length;
    }
    async function newChat() {
        const d = await request('ai.create', {});
        if (d?.conversation) {
            conversations.value.unshift({ id: d.conversation.id, title: d.conversation.title, updatedAt: d.conversation.updatedAt, messageCount: 0, state: 'idle' });
            currentId.value = d.conversation.id;
            currentTitle.value = d.conversation.title;
            messages.value = [];
            stream?.resetStreaming();
            oldestIndex = 0;
            hasMore.value = false;
            viewSeq.value++;
        }
        return d?.conversation || null;
    }
    async function rename(id, title) {
        const d = await request('ai.rename', { chatId: id, title });
        if (d?.conversation) {
            const c = conversations.value.find((x) => x.id === id);
            if (c) c.title = d.conversation.title;
            if (currentId.value === id) currentTitle.value = d.conversation.title;
        }
    }
    async function remove(id) {
        await request('ai.delete', { chatId: id });
        conversations.value = conversations.value.filter((c) => c.id !== id);
        if (currentId.value === id) { currentId.value = ''; messages.value = []; currentTitle.value = ''; hasMore.value = false; oldestIndex = 0; }
    }
    async function send(text) {
        const content = (text || '').trim();
        if (!content || busy.value) return;
        if (!currentId.value) { const c = await newChat(); if (!c) return; }
        busy.value = true;
        viewSeq.value++; // 发送 → 强制滚到底
        ws.sendMsg({ type: 'ai.send', to: 'desktop', data: { chatId: currentId.value, content } });
    }
    function abort() {
        if (!currentId.value) return;
        busy.value = false;
        stream?.resetStreaming();
        bumpStream();
        ws.sendMsg({ type: 'ai.abort', to: 'desktop', data: { chatId: currentId.value } });
    }

    return {
        conversations, currentId, currentTitle, messages, busy, ready,
        streamTick, viewSeq, hasMore, loadingOlder,
        bind, refresh, openChat, loadOlder, newChat, rename, remove, send, abort,
    };
});

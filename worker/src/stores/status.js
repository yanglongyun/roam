import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useWsStore } from './ws';

const pending = new Map();
let handlersBound = false;

function newReqId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function bindHandlers(ws) {
    if (handlersBound) return;
    handlersBound = true;
    ws.onMessage('status.result', (msg) => {
        const h = pending.get(msg.data?.reqId);
        if (!h) return;
        pending.delete(msg.data.reqId);
        clearTimeout(h.timer);
        if (msg.data.ok) h.resolve(msg.data);
        else h.reject(new Error(msg.data.error || '获取状态失败'));
    });
}

export const useStatusStore = defineStore('status', () => {
    const ws = useWsStore();
    bindHandlers(ws);

    const data = ref(null);
    const loading = ref(false);
    const errorMsg = ref('');
    const capturedAt = ref(0);

    let pollTimer = null;

    function callOnce(timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const reqId = newReqId();
            const timer = setTimeout(() => {
                pending.delete(reqId);
                reject(new Error('请求超时'));
            }, timeoutMs);
            pending.set(reqId, { resolve, reject, timer });
            ws.sendMsg({ type: 'status.request', to: 'desktop', data: { reqId } });
        });
    }

    async function refresh() {
        if (!ws.canUseActions) return;
        loading.value = true;
        errorMsg.value = '';
        try {
            const res = await callOnce();
            const { reqId, ok, ...rest } = res;
            data.value = rest;
            capturedAt.value = rest.capturedAt || Date.now();
        } catch (err) {
            errorMsg.value = err.message || String(err);
        } finally {
            loading.value = false;
        }
    }

    function startPolling(intervalMs = 5000) {
        stopPolling();
        refresh();
        pollTimer = setInterval(refresh, intervalMs);
    }

    function stopPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    return { data, loading, errorMsg, capturedAt, refresh, startPolling, stopPolling };
});

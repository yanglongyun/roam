// HTTP 处理业务请求，WS 只接收实时事件；各应用分别保存会话状态。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useWsStore } from '@/stores/ws';
import { agentHttpRequest } from '../../shared/agent-http.js';

export const useAgentClientStore = defineStore('agent-client', () => {
    const ws = useWsStore();
    const status = ref(null);
    const eventHooks = new Set();

    async function request(op, args = {}, timeoutMs = 30000) {
        const { url, method, body } = agentHttpRequest(op, args);
        const token = ws.getAuthToken();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method, body, cache: 'no-store', signal: controller.signal,
                headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            });
            if (response.status === 401) ws.invalidateAuth(token);
            let result;
            try { result = await response.json(); } catch { throw new Error(`服务响应异常（HTTP ${response.status}）`); }
            if (!response.ok || !result.ok) {
                const error = new Error(result.error || `操作失败（HTTP ${response.status}）`);
                error.status = response.status;
                throw error;
            }
            return result.data;
        } catch (error) {
            if (controller.signal.aborted) throw new Error('请求超时，请重试');
            if (error instanceof TypeError) throw new Error('无法连接云端，请检查网络后重试');
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    ws.onMessage('agent.event', (msg) => {
        for (const hook of eventHooks) hook(msg.data || {});
    });

    function onEvent(fn) {
        eventHooks.add(fn);
        return () => eventHooks.delete(fn);
    }

    async function loadStatus() {
        status.value = await request('status.get');
        return status.value;
    }
    const getConfig = () => request('config.get');
    async function saveConfig(patch) {
        await request('config.put', patch);
        await loadStatus();
    }
    const usageStats = (tzOffset = -new Date().getTimezoneOffset()) => request('usage.stats', { tz_offset: tzOffset });
    const patchDevice = (patch) => request('devices.patch', patch);
    const removeDevice = (id) => request('devices.remove', { id });

    return { request, onEvent, status, loadStatus, getConfig, saveConfig, usageStats, patchDevice, removeDevice };
});

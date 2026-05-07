<script>
const pending = new Map();
let bound = false;

function newReqId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ensureBound(ws) {
    if (bound) return;
    bound = true;
    ws.onMessage('status.result', (msg) => {
        const h = pending.get(msg.data?.reqId);
        if (!h) return;
        pending.delete(msg.data.reqId);
        clearTimeout(h.timer);
        if (msg.data.ok) h.resolve(msg.data);
        else h.reject(new Error(msg.data.error || '获取状态失败'));
    });
}
</script>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useWsStore } from '@/stores/ws';

const ws = useWsStore();
ensureBound(ws);

const data = ref(null);
const loading = ref(false);
const errorMsg = ref('');
const capturedAt = ref(0);

let pollTimer = null;

const d = computed(() => data.value);

const capturedText = computed(() => {
    if (!capturedAt.value) return '尚未获取';
    return new Date(capturedAt.value).toLocaleString();
});

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

function fmtBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`;
}

function fmtUptime(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '—';
    const dd = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const parts = [];
    if (dd) parts.push(`${dd}天`);
    if (h) parts.push(`${h}小时`);
    if (m || (!dd && !h)) parts.push(`${m}分钟`);
    return parts.join(' ');
}

function pctClass(p) {
    if (p < 60) return 'bg-emerald-500';
    if (p < 85) return 'bg-amber-400';
    return 'bg-rose-500';
}

onMounted(() => {
    if (ws.canUseActions) startPolling(5000);
});

watch(() => ws.canUseActions, (ready) => {
    if (ready) startPolling(5000);
    else stopPolling();
});

onUnmounted(stopPolling);
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col bg-zinc-950">
        <div class="shrink-0 border-b border-zinc-800 bg-zinc-900/70 px-3 py-2 flex items-center gap-2">
            <button
                @click="refresh"
                :disabled="loading || !ws.canUseActions"
                class="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 transition-colors hover:bg-zinc-700 active:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
                title="立即刷新">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
                    <path d="M3 21v-5h5" />
                    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
                    <path d="M21 3v5h-5" />
                </svg>
                <span>{{ loading ? '获取中' : '刷新' }}</span>
            </button>
            <div class="ml-auto text-xs text-zinc-500">
                <span v-if="errorMsg" class="text-rose-300">{{ errorMsg }}</span>
                <span v-else>每 5 秒自动刷新 · {{ capturedText }}</span>
            </div>
        </div>

        <main v-if="!ws.showActions && !ws.isReconnecting"
            class="flex-1 min-h-0 flex items-center justify-center text-sm text-zinc-500">
            等待客户端连接和认证
        </main>

        <main v-else-if="!d && loading"
            class="flex-1 min-h-0 flex items-center justify-center text-sm text-zinc-500">
            正在获取系统状态...
        </main>

        <main v-else-if="d" class="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <div class="mx-auto w-full max-w-2xl space-y-4">
                <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">主机</h3>
                    <dl class="grid grid-cols-2 gap-y-2 text-sm">
                        <dt class="text-zinc-500">主机名</dt>
                        <dd class="text-zinc-100 truncate">{{ d.host.hostname }}</dd>
                        <dt class="text-zinc-500">系统</dt>
                        <dd class="text-zinc-100">{{ d.host.platform }} {{ d.host.release }}</dd>
                        <dt class="text-zinc-500">架构</dt>
                        <dd class="text-zinc-100">{{ d.host.arch }}</dd>
                        <dt class="text-zinc-500">运行时长</dt>
                        <dd class="text-zinc-100">{{ fmtUptime(d.host.uptime) }}</dd>
                    </dl>
                </section>

                <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <div class="flex items-baseline justify-between mb-3">
                        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500">CPU</h3>
                        <div class="text-2xl font-mono text-zinc-100">{{ d.cpu.usagePercent }}<span class="text-base text-zinc-500"> %</span></div>
                    </div>
                    <div class="h-1.5 rounded bg-zinc-800 overflow-hidden mb-3">
                        <div class="h-full transition-all" :class="pctClass(d.cpu.usagePercent)"
                            :style="`width: ${Math.min(100, d.cpu.usagePercent)}%`"></div>
                    </div>
                    <dl class="grid grid-cols-2 gap-y-2 text-sm">
                        <dt class="text-zinc-500">核心</dt>
                        <dd class="text-zinc-100">{{ d.cpu.count }}</dd>
                        <dt class="text-zinc-500">型号</dt>
                        <dd class="text-zinc-100 truncate">{{ d.cpu.model }}</dd>
                        <dt class="text-zinc-500">主频</dt>
                        <dd class="text-zinc-100">{{ d.cpu.speed ? (d.cpu.speed / 1000).toFixed(2) + ' GHz' : '—' }}</dd>
                        <dt class="text-zinc-500">Load 1/5/15</dt>
                        <dd class="text-zinc-100 font-mono">
                            {{ d.cpu.loadavg.map(n => n.toFixed(2)).join(' / ') }}
                        </dd>
                    </dl>
                </section>

                <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <div class="flex items-baseline justify-between mb-3">
                        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500">内存</h3>
                        <div class="text-2xl font-mono text-zinc-100">{{ d.mem.percent }}<span class="text-base text-zinc-500"> %</span></div>
                    </div>
                    <div class="h-1.5 rounded bg-zinc-800 overflow-hidden mb-3">
                        <div class="h-full transition-all" :class="pctClass(d.mem.percent)"
                            :style="`width: ${Math.min(100, d.mem.percent)}%`"></div>
                    </div>
                    <dl class="grid grid-cols-2 gap-y-2 text-sm">
                        <dt class="text-zinc-500">已用 / 总量</dt>
                        <dd class="text-zinc-100 font-mono">{{ fmtBytes(d.mem.used) }} / {{ fmtBytes(d.mem.total) }}</dd>
                        <dt class="text-zinc-500">空闲</dt>
                        <dd class="text-zinc-100 font-mono">{{ fmtBytes(d.mem.free) }}</dd>
                    </dl>
                </section>

                <section v-if="d.disk" class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <div class="flex items-baseline justify-between mb-3">
                        <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500">磁盘 ({{ d.disk.mount }})</h3>
                        <div class="text-2xl font-mono text-zinc-100">{{ d.disk.percent }}<span class="text-base text-zinc-500"> %</span></div>
                    </div>
                    <div class="h-1.5 rounded bg-zinc-800 overflow-hidden mb-3">
                        <div class="h-full transition-all" :class="pctClass(d.disk.percent)"
                            :style="`width: ${Math.min(100, d.disk.percent)}%`"></div>
                    </div>
                    <dl class="grid grid-cols-2 gap-y-2 text-sm">
                        <dt class="text-zinc-500">已用 / 总量</dt>
                        <dd class="text-zinc-100 font-mono">{{ fmtBytes(d.disk.used) }} / {{ fmtBytes(d.disk.total) }}</dd>
                        <dt class="text-zinc-500">可用</dt>
                        <dd class="text-zinc-100 font-mono">{{ fmtBytes(d.disk.free) }}</dd>
                    </dl>
                </section>

                <section v-if="d.network?.length" class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                    <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">网络</h3>
                    <ul class="text-sm space-y-1.5">
                        <li v-for="iface in d.network" :key="iface.name + iface.address"
                            class="flex justify-between gap-3">
                            <span class="text-zinc-500 shrink-0">{{ iface.name }}</span>
                            <span class="text-zinc-100 font-mono truncate">{{ iface.address }}</span>
                        </li>
                    </ul>
                </section>
            </div>
        </main>
    </div>
</template>

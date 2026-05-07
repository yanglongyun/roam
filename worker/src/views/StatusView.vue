<script setup>
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useWsStore } from '@/stores/ws';
import { useStatusStore } from '@/stores/status';

const ws = useWsStore();
const status = useStatusStore();

const d = computed(() => status.data);

const capturedText = computed(() => {
    if (!status.capturedAt) return '尚未获取';
    return new Date(status.capturedAt).toLocaleString();
});

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
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d}天`);
    if (h) parts.push(`${h}小时`);
    if (m || (!d && !h)) parts.push(`${m}分钟`);
    return parts.join(' ');
}

function pctClass(p) {
    if (p < 60) return 'bg-emerald-500';
    if (p < 85) return 'bg-amber-400';
    return 'bg-rose-500';
}

onMounted(() => {
    if (ws.canUseActions) status.startPolling(5000);
});

watch(() => ws.canUseActions, (ready) => {
    if (ready) status.startPolling(5000);
    else status.stopPolling();
});

onUnmounted(() => {
    status.stopPolling();
});
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col bg-zinc-950">
        <div class="shrink-0 border-b border-zinc-800 bg-zinc-900/70 px-3 py-2 flex items-center gap-2">
            <button
                @click="status.refresh"
                :disabled="status.loading || !ws.canUseActions"
                class="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 transition-colors hover:bg-zinc-700 active:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
                title="立即刷新">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
                    <path d="M3 21v-5h5" />
                    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
                    <path d="M21 3v5h-5" />
                </svg>
                <span>{{ status.loading ? '获取中' : '刷新' }}</span>
            </button>
            <div class="ml-auto text-xs text-zinc-500">
                <span v-if="status.errorMsg" class="text-rose-300">{{ status.errorMsg }}</span>
                <span v-else>每 5 秒自动刷新 · {{ capturedText }}</span>
            </div>
        </div>

        <main v-if="!ws.showActions && !ws.isReconnecting"
            class="flex-1 min-h-0 flex items-center justify-center text-sm text-zinc-500">
            等待客户端连接和认证
        </main>

        <main v-else-if="!d && status.loading"
            class="flex-1 min-h-0 flex items-center justify-center text-sm text-zinc-500">
            正在获取系统状态...
        </main>

        <main v-else-if="d" class="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <div class="mx-auto w-full max-w-2xl space-y-4">
                <!-- Host -->
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

                <!-- CPU -->
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

                <!-- Memory -->
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

                <!-- Disk -->
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

                <!-- Network -->
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

<script setup>
import { computed } from 'vue';
import { useWsStore } from '@/stores/ws';
import { useRoute } from 'vue-router';

const ws = useWsStore();
const route = useRoute();

const show = computed(() => {
    if (route.name === 'guard') return false;  // guard 自己显示状态
    if (ws.invalid || ws.superseded) return true;
    if (ws.connectionLost) return true;
    return !ws.showActions && !ws.isReconnecting;
});

const status = computed(() => {
    if (ws.invalid)            return { id: 'invalid',    label: '无效的访问链接，请用客户端刚打印的最新链接' };
    if (ws.superseded)         return { id: 'superseded', label: '已在另一台设备登录，刷新可重新登录' };
    if (ws.state === 'offline')return { id: 'offline',    label: '连接已断开，重连中…' };
    if (ws.state === 'pending')return { id: 'pending',    label: '等待客户端上线…' };
    if (!ws.authenticated && ws.requiresPassword)
                               return { id: 'pending',    label: '等待认证…' };
    return                           { id: 'pending',    label: '连接中…' };
});
</script>

<template>
    <Transition name="gate-fade">
        <div v-if="show"
            class="fixed inset-0 z-30 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
            <div class="flex flex-col items-center gap-3">
                <div class="font-serif font-black text-[28px] leading-none tracking-tight text-ink">
                    漫游<span class="text-accent">.</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="gate-dot" :data-state="status.id"></span>
                    <span class="text-xs text-muted">{{ status.label }}</span>
                </div>
            </div>
        </div>
    </Transition>
</template>

<style scoped>
.gate-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--color-faint);
    display: inline-block;
}
.gate-dot[data-state="pending"]    { background: var(--color-accent); animation: gate-pulse 1.4s ease-in-out infinite; }
.gate-dot[data-state="offline"]    { background: var(--color-bad); }
.gate-dot[data-state="invalid"]    { background: var(--color-faint); }
.gate-dot[data-state="superseded"] { background: var(--color-faint); }

@keyframes gate-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.35; }
}

.gate-fade-enter-active, .gate-fade-leave-active { transition: opacity .18s ease; }
.gate-fade-enter-from, .gate-fade-leave-to { opacity: 0; }
</style>

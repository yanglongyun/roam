<script setup>
import { computed } from 'vue';
import { useWsStore } from '@/stores/ws';
import { useRoute } from 'vue-router';

const ws = useWsStore();
const route = useRoute();
const cloudView = computed(() => ['assistant', 'tasks', 'settings', 'usage'].includes(String(route.name)));
const readingOffline = computed(() => cloudView.value && ws.authenticated && !ws.showActions);

const show = computed(() => {
    if (route.name === 'guard') return false;  // guard 自己显示状态
    if (readingOffline.value) return false;  // HTTP 查询不依赖实时连接。
    if (ws.connectionLost) return true;
    return !ws.showActions && !ws.isReconnecting;
});

const status = computed(() => {
    if (ws.state === 'offline')return { id: 'offline',    label: '连接已断开，重连中…' };
    if (ws.state === 'pending')return { id: 'pending',    label: '正在连接云端…' };
    if (!ws.authenticated)     return { id: 'pending',    label: '等待登录…' };
    return                           { id: 'pending',    label: '连接中…' };
});
</script>

<template>
    <div v-if="readingOffline" role="status" class="ws-read-notice">实时连接正在重连，历史记录仍可查看。</div>
    <div v-if="show"
        class="gate-fixed fixed inset-0 z-30 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
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
</template>

<style scoped>
.ws-read-notice { position: fixed; z-index: 30; top: 60px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 24px); padding: 8px 12px; border: 1px solid var(--color-line-hi); border-radius: 8px; background: var(--color-bg-elev); color: var(--color-muted); font-size: 12px; white-space: nowrap; pointer-events: none; }
.gate-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--color-faint);
    display: inline-block;
}
.gate-dot[data-state="pending"]    { background: var(--color-accent); animation: gate-pulse 1.4s ease-in-out infinite; }
.gate-dot[data-state="offline"]    { background: var(--color-bad); }

@keyframes gate-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.35; }
}

/* 只淡入，不淡出：离开的过渡在后台标签页里不会推进（transitionend 不来），
   遮罩会卡在那儿挡住整个界面。淡出省掉，消失就是瞬间的，看不出来。 */
/* 不用 <Transition>：它靠 requestAnimationFrame 推进，标签页在后台时 rAF 不跑，
   离开动画会卡在中间 —— 遮罩留着，整页点不动。用 CSS 动画自己淡入，消失就是瞬间的。 */
.gate-fixed { animation: gate-in .18s ease both; }

@keyframes gate-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}
</style>

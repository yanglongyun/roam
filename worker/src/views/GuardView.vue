<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useWsStore } from '@/stores/ws';

const router = useRouter();
const ws = useWsStore();
const password = ref('');

const status = computed(() => {
    if (ws.authClosed) return { id: 'locked',     label: '认证已锁定' };
    if (ws.superseded) return { id: 'superseded', label: '已在另一台设备登录' };
    if (ws.invalid)    return { id: 'invalid',    label: '无效的访问链接' };
    if (ws.state === 'connected')
                       return { id: 'connected',  label: '远程客户端已连接' };
    return                    { id: 'pending',    label: '客户端未连接' };
});

const canSubmit = computed(() =>
    !ws.authClosed
    && !ws.superseded
    && !ws.invalid
    && ws.state === 'connected'
);

function onSubmit() {
    if (!canSubmit.value) return;
    ws.submitPassword(password.value);
}

function toTerminal() {
    router.replace({ path: '/terminal', query: router.currentRoute.value.query });
}

onMounted(() => {
    if (ws.authenticated) toTerminal();
});

watch(() => ws.authenticated, (v) => { if (v) toTerminal(); });
</script>

<template>
    <main class="flex-1 min-h-0 flex items-center justify-center px-6 py-10 overflow-y-auto bg-bg">
        <div class="w-full max-w-sm flex flex-col items-center">
            <h1 class="font-serif font-black text-[40px] leading-none tracking-tight text-center text-ink">
                漫游<span class="text-accent">.</span>
            </h1>

            <div class="mt-6 flex items-center gap-2">
                <span class="status-dot" :data-state="status.id"></span>
                <span class="text-xs text-muted">{{ status.label }}</span>
            </div>

            <form class="w-full mt-6 flex flex-col gap-3" @submit.prevent="onSubmit">
                <input
                    v-model="password"
                    type="password"
                    autocomplete="current-password"
                    placeholder="访问密码"
                    class="h-11 w-full rounded-[10px] border border-line bg-bg-elev px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent"
                    :disabled="ws.authClosed || ws.superseded"
                />

                <div v-if="ws.authError"
                    class="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[11.5px] text-bad">
                    {{ ws.authError }}
                </div>

                <button type="submit"
                    class="h-11 w-full rounded-[10px] bg-accent text-bg text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
                    :disabled="!canSubmit">
                    进入会话
                </button>
            </form>
        </div>
    </main>
</template>

<style scoped>
.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--color-faint);
    display: inline-block;
}
.status-dot[data-state="connected"]  { background: var(--color-good);   box-shadow: 0 0 8px color-mix(in srgb, var(--color-good) 60%, transparent); }
.status-dot[data-state="pending"]    { background: var(--color-accent); animation: dot-pulse 1.4s ease-in-out infinite; }
.status-dot[data-state="offline"]    { background: var(--color-bad); }
.status-dot[data-state="locked"]     { background: var(--color-bad); }
.status-dot[data-state="superseded"] { background: var(--color-faint); }
.status-dot[data-state="invalid"]    { background: var(--color-faint); }

@keyframes dot-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.35; }
}
</style>

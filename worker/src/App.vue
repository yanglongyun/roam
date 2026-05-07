<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWsStore } from '@/stores/ws';
import AppHeader from '@/components/AppHeader.vue';
import AppDrawer from '@/components/AppDrawer.vue';
import ToastHost from '@/components/ToastHost.vue';
import ConnectionGate from '@/components/ConnectionGate.vue';

const ws = useWsStore();
const route = useRoute();
const router = useRouter();

const showChrome = computed(() => route.name !== 'guard');

onMounted(() => {
    ws.init();
});

// 未认证 + 需要密码 → 强制去守卫页；短暂重连期间先保留当前页面。
watch(
    () => [ws.requiresPassword, ws.authenticated, ws.invalid, ws.isReconnecting],
    ([req, authed, invalid, reconnecting]) => {
        if (invalid) return;
        if (req && !authed && !reconnecting && route.name !== 'guard') {
            router.replace({ path: '/guard', query: route.query });
        }
    },
    { immediate: true }
);
</script>

<template>
    <AppHeader v-if="showChrome" />
    <AppDrawer v-if="showChrome" />

    <router-view v-slot="{ Component }">
        <keep-alive>
            <component :is="Component" />
        </keep-alive>
    </router-view>

    <ConnectionGate />
    <ToastHost />
</template>

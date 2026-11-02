<script setup>
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWsStore } from '@/stores/ws';
import AppHeader from '@/components/AppHeader.vue';
import SideDrawer from '@/components/SideDrawer.vue';
import AppCenter from '@/components/AppCenter.vue';
import ToastHost from '@/components/ToastHost.vue';
import ConnectionGate from '@/components/ConnectionGate.vue';

const ws = useWsStore();
const route = useRoute();
const router = useRouter();

const showChrome = computed(() => route.name !== 'guard');

onMounted(() => {
    ws.init();
});

// 连上云端但未登录 → 回守卫页，记住原来想去的页面；短暂重连期间先保留当前页面。
watch(
    () => [ws.authenticated, ws.isReconnecting, ws.state],
    ([authed, reconnecting, state]) => {
        if (state !== 'connected' || authed || reconnecting) return;
        if (route.name !== 'guard') {
            const query = route.fullPath.length > 1 ? { redirect: route.fullPath } : {};
            router.replace({ path: '/guard', query });
        }
    },
    { immediate: true }
);
</script>

<template>
    <AppHeader v-if="showChrome" />
    <SideDrawer v-if="showChrome" />
    <AppCenter v-if="showChrome" />

    <router-view v-slot="{ Component }">
        <keep-alive>
            <component :is="Component" />
        </keep-alive>
    </router-view>

    <ConnectionGate />
    <ToastHost />
</template>

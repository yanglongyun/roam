import { createRouter, createWebHistory } from 'vue-router';
import { useWsStore } from '@/stores/ws';

const routes = [
    { path: '/', redirect: '/guard' },
    {
        path: '/guard',
        name: 'guard',
        meta: { public: true },
        component: () => import('./views/GuardView.vue'),
    },
    {
        path: '/terminal',
        name: 'terminal',
        component: () => import('./views/TerminalView.vue'),
    },
    {
        path: '/chat',
        name: 'chat',
        component: () => import('./views/ChatView.vue'),
    },
    {
        path: '/files',
        name: 'files',
        component: () => import('./views/FilesView.vue'),
    },
    {
        path: '/status',
        name: 'status',
        component: () => import('./views/StatusView.vue'),
    },
    {
        path: '/screen',
        name: 'screen',
        component: () => import('./views/ScreenView.vue'),
    },
    {
        path: '/settings',
        name: 'settings',
        component: () => import('./views/SettingsView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/guard' },
];

export const router = createRouter({
    history: createWebHistory(),
    routes,
});

router.beforeEach((to) => {
    if (to.meta?.public) return true;

    const ws = useWsStore();
    // 刚打开页面还没连上云端：先放行（ConnectionGate 盖着），连上后由 App.vue 决定去不去守卫页，
    // 这样刷新 /terminal、/status 这类深链接不会被打回 /chat。
    if (ws.state === 'pending' && !ws.authenticated) return true;
    if (!ws.authenticated && !ws.isReconnecting) {
        return { path: '/guard', query: { redirect: to.fullPath } };
    }
    return true;
});

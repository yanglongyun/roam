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
        path: '/assistant',
        name: 'assistant',
        component: () => import('./views/AssistantView.vue'),
    },
    {
        path: '/tasks/:id?',
        name: 'tasks',
        component: () => import('./views/TasksView.vue'),
    },
    { path: '/chat/:pathMatch(.*)*', redirect: '/assistant' },
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
        path: '/usage',
        name: 'usage',
        component: () => import('./views/UsageView.vue'),
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
    // 这样刷新终端、任务详情这类深链接不会被打回助理。
    if (ws.state === 'pending' && !ws.authenticated) return true;
    if (!ws.authenticated && !ws.isReconnecting) {
        return { path: '/guard', query: { redirect: to.fullPath } };
    }
    return true;
});

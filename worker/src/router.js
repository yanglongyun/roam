import { createRouter, createWebHistory } from 'vue-router';
import { useWsStore } from '@/stores/ws';

const routes = [
    { path: '/', redirect: (to) => ({ path: '/guard', query: to.query }) },
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
        path: '/files',
        name: 'files',
        component: () => import('./views/FilesView.vue'),
    },
    {
        path: '/screen',
        name: 'screen',
        component: () => import('./views/ScreenView.vue'),
    },
    {
        path: '/agent',
        name: 'agent',
        component: () => import('./views/AgentView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: (to) => ({ path: '/guard', query: to.query }) },
];

export const router = createRouter({
    history: createWebHistory(),
    routes,
});

router.beforeEach((to, from) => {
    const patched = { ...to };
    if (!to.query.session && from.query.session) {
        patched.query = { ...to.query, session: from.query.session };
        return patched;
    }

    if (to.meta?.public) return true;

    const ws = useWsStore();
    if (ws.requiresPassword && !ws.authenticated && !ws.isReconnecting) {
        return { path: '/guard', query: to.query };
    }
    return true;
});

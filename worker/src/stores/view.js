import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useViewStore = defineStore('view', () => {
    // 左上角菜单只用于终端列表；助理、任务各有独立页面。
    const showSide = ref(false);
    // 右上角宫格：应用中心
    const showApps = ref(false);

    // side：该应用是否有左侧菜单
    const apps = [
        {
            path: '/assistant',
            label: '助理',
            iconPath: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
        },
        {
            path: '/tasks',
            label: '任务',
            iconPath: 'M9 5h12 M9 12h12 M9 19h12 M3 5l1 1 2-2 M3 12l1 1 2-2 M3 19l1 1 2-2',
        },
        {
            path: '/terminal',
            label: '终端',
            side: true,
            iconPath: 'M4 17l6-6-6-6 M12 19h8',
        },
        {
            path: '/files',
            label: '文件',
            iconPath: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
        },
        {
            path: '/status',
            label: '状态',
            iconPath: 'M3 12h4l3-9 4 18 3-9h4',
        },
        {
            path: '/usage',
            label: '用量',
            iconPath: 'M3 3v18h18 M7 16v-5 M12 16V7 M17 16v-9',
        },
        {
            path: '/screen',
            label: '屏幕',
            iconPath: 'M3 5h18v12H3z M8 21h8 M12 17v4',
        },
        {
            path: '/settings',
            label: '设置',
            iconPath: 'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M16 10v4 M10 16v4',
        },
    ];

    function appOf(path) {
        return apps.find((item) => item.path === path || path.startsWith(item.path + '/')) || null;
    }

    function openSide() { showApps.value = false; showSide.value = true; }
    function closeSide() { showSide.value = false; }
    function toggleApps() { showApps.value = !showApps.value; }
    function closeApps() { showApps.value = false; }

    return { showSide, showApps, apps, appOf, openSide, closeSide, toggleApps, closeApps };
});

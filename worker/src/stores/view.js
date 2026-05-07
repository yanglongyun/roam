import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useViewStore = defineStore('view', () => {
    const showDrawer = ref(false);

    const navItems = [
        {
            path: '/terminal',
            label: '终端',
            iconPath: 'M4 17l6-6-6-6 M12 19h8',
        },
        {
            path: '/files',
            label: '文件',
            iconPath: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
        },
        {
            path: '/screen',
            label: '屏幕',
            iconPath: 'M3 5h18v12H3z M8 21h8 M12 17v4',
        },
    ];

    function toggleDrawer() { showDrawer.value = !showDrawer.value; }
    function closeDrawer() { showDrawer.value = false; }

    return { showDrawer, navItems, toggleDrawer, closeDrawer };
});

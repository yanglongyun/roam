<script setup>
// 助理界面用到的几个线条图标
defineProps({
    name: { type: String, required: true },
    size: { type: Number, default: 14 },
});

const PATHS = {
    doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h4',
    pen: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    terminal: 'M4 17l6-6-6-6 M12 19h8',
    desktop: 'M3 4h18v13H3z M8 21h8 M12 17v4',
    globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    chev: 'M9 6l6 6-6 6',
    copy: 'M9 9h10v12H9z M5 15V3h10',
    image: 'M3 5h18v14H3z M8.5 10a1.5 1.5 0 1 0 0-3a1.5 1.5 0 1 0 0 3z M21 15l-5-5L5 19',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    pin: 'M12 17v5 M9 3h6l-1 6 3 3v2H7v-2l3-3z',
};
</script>

<template>
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path :d="PATHS[name] || PATHS.terminal" />
    </svg>
</template>

<script setup>
// 消息里的图片地址 /api/images/<文件名> 存在云端 R2，经助理 store 取回成 blob 地址再显示
import { ref, watchEffect } from 'vue';
import { useConversation } from '@/lib/agent/conversation';

const props = defineProps({
    src: { type: String, required: true },
    alt: { type: String, default: '图片' },
});

const agent = useConversation();
const url = ref('');
const failed = ref(false);

watchEffect(() => {
    const src = props.src;
    url.value = '';
    failed.value = false;
    agent.imageSrc(src).then((value) => {
        if (props.src === src) url.value = value;
    }).catch(() => {
        if (props.src === src) failed.value = true;
    });
});
</script>

<template>
    <a v-if="url" :href="url" target="_blank" rel="noopener"><img :src="url" :alt="alt" /></a>
    <span v-else class="img-ph">{{ failed ? '图片不可用' : '…' }}</span>
</template>

<script setup>
import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue';
import { useAssistantStore } from '@/stores/agent';
import ConversationPane from '@/components/agent/ConversationPane.vue';

const assistant = useAssistantStore();
onMounted(() => assistant.init());
onActivated(() => assistant.setVisible(true));
onDeactivated(() => assistant.setVisible(false));
onBeforeUnmount(() => assistant.setVisible(false));
</script>

<template>
    <ConversationPane :agent="assistant" />
</template>

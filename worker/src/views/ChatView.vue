<script setup>
import { onMounted } from 'vue';
import { useAgentStore } from '@/stores/agent';
import MessageStream from '@/components/agent/MessageStream.vue';
import Composer from '@/components/agent/Composer.vue';
import '@/components/agent/agent.css';

const agent = useAgentStore();

onMounted(() => agent.init());
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col bg-zinc-950">
        <MessageStream />
        <Composer />
    </div>
</template>

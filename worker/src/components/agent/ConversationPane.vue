<script setup>
import { provide } from 'vue';
import { conversationKey } from '@/lib/agent/conversation';
import MessageStream from './MessageStream.vue';
import Composer from './Composer.vue';
import TaskBar from './TaskBar.vue';
import './agent.css';

const props = defineProps({
    agent: { type: Object, required: true },
    task: { type: Boolean, default: false },
});

provide(conversationKey, props.agent);
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col bg-zinc-950">
        <TaskBar v-if="task" />
        <MessageStream />
        <Composer />
    </div>
</template>

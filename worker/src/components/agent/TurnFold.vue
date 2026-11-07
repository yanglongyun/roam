<script setup>
// 轮折叠条：「已工作 X ›」+ 通栏细线。进折叠条的一定是已收尾的轮。
import { computed } from 'vue';
import { useConversation } from '@/lib/agent/conversation';
import { formatDuration } from '@/lib/agent/format';
import Icon from './Icon.vue';

const props = defineProps({
    id: { type: String, required: true },
    durationMs: { type: Number, default: null },
});

const agent = useConversation();
const open = computed(() => agent.expanded[props.id] === true);
const toggle = () => { agent.expanded[props.id] = !open.value; };
const label = computed(() => (props.durationMs != null && props.durationMs > 0 ? `已工作 ${formatDuration(props.durationMs)}` : '过程'));
</script>

<template>
    <div class="fold" :class="{ open }">
        <button class="fold-head" @click="toggle">
            <span class="fold-row">
                <span class="fold-label">{{ label }}</span>
                <span class="fold-chev"><Icon name="chev" :size="12" /></span>
            </span>
            <span class="fold-line"></span>
        </button>
        <div v-if="open" class="fold-body"><slot /></div>
    </div>
</template>

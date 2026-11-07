<script setup>
import { computed } from 'vue';
import { useConversation } from '@/lib/agent/conversation';
import Icon from './Icon.vue';

const props = defineProps({
    row: { type: Object, required: true },
    compact: { type: Boolean, default: false },
});

// 展开状态属于当前会话，列表分组和刷新不会丢失。
const agent = useConversation();
const open = computed(() => agent.expanded[props.row.key] === true);
const toggle = () => { agent.expanded[props.row.key] = !open.value; };
const thinking = computed(() => Boolean(props.row.streaming && !props.row.content));
</script>

<template>
    <div class="step" :class="{ open, sm: compact }">
        <button class="step-head" @click="toggle">
            <span class="step-ic">
                <span class="step-glyph"><Icon name="spark" :size="compact ? 12 : 14" /></span>
                <span class="step-chev"><Icon name="chev" :size="12" /></span>
            </span>
            <span class="step-label"><i :class="{ sheen: thinking }">{{ thinking ? '思考中' : '已思考' }}</i></span>
        </button>
        <div v-if="open" class="step-body">
            <div class="step-block">{{ row.reasoning }}</div>
        </div>
    </div>
</template>

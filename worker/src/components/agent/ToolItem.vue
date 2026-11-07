<script setup>
import { computed } from 'vue';
import { useConversation } from '@/lib/agent/conversation';
import { fmtArgs, fmtResult, isFailed, toolMeta } from '@/lib/agent/format';
import Icon from './Icon.vue';
import AgentImage from './AgentImage.vue';

const props = defineProps({
    row: { type: Object, required: true },
    compact: { type: Boolean, default: false },
});

const agent = useConversation();
const open = computed(() => agent.expanded[props.row.key] === true);
const meta = computed(() => toolMeta(props.row));
const running = computed(() => props.row.status === 'running');
const toggle = () => { if (!running.value) agent.expanded[props.row.key] = !open.value; };
</script>

<template>
    <div class="step" :class="{ open, sm: compact, faded: isFailed(row) }">
        <button class="step-head" :disabled="running" @click="toggle">
            <span class="step-ic">
                <span class="step-glyph"><Icon :name="meta.icon" :size="compact ? 13 : 15" /></span>
                <span class="step-chev"><Icon name="chev" :size="12" /></span>
            </span>
            <span class="step-label">
                <i :class="{ sheen: running }">{{ meta.label }}</i>
                <span v-if="meta.pill" class="step-pill"><span>{{ meta.pill }}</span></span>
            </span>
        </button>
        <div v-if="open" class="step-body">
            <div class="step-block">{{ fmtArgs(row.args) }}</div>
            <div class="step-block">{{ row.result ? fmtResult(row.result) : '没有输出' }}</div>
            <div v-if="row.images?.length" class="message-files">
                <AgentImage v-for="(src, index) in row.images" :key="index" :src="src" alt="工具读取的图片" />
            </div>
        </div>
    </div>
</template>

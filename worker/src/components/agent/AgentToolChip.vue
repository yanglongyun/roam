<script setup>
import { ref } from 'vue';

const props = defineProps({
    title:   { type: String, default: 'tool' },
    command: { type: String, default: '' },
    detail:  { type: String, default: '' },
    result:  { type: String, default: null },
    status:  { type: String, default: 'running' },  // running / ok / err
    kind:    { type: String, default: 'tool' },
    subMessages: { type: Array, default: () => [] },
});

const open = ref(false);

function summarizeSubMessage(message) {
    if (message.role === 'user') return String(message.content || '');
    if (message.role === 'tool') return String(message.content || '');
    if (message.toolCalls?.length) {
        return message.toolCalls.map((toolCall) => {
            const name = toolCall?.function?.name || 'tool';
            const args = toolCall?.function?.arguments || '';
            return `${name} ${args}`;
        }).join('\n');
    }
    return String(message.content || '');
}
</script>

<template>
    <details :open="open" @toggle="open = $event.target.open"
        class="self-start max-w-full rounded-[10px] border bg-bg-elev overflow-hidden"
        :class="kind === 'agent' ? 'border-accent/50' : 'border-line'">
        <summary class="list-none flex items-center gap-2 px-3 py-2 cursor-pointer">
            <span class="text-[13px] leading-none inline-block transition-transform text-faint"
                :class="open ? 'rotate-90' : ''">›</span>
            <span v-if="kind === 'agent'"
                class="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
                AGENT
            </span>
            <span class="font-mono text-[12px] truncate flex-1 text-ink">{{ title }}</span>
            <span class="text-[13px] leading-none flex-shrink-0"
                :class="{
                    'text-good':   status === 'ok',
                    'text-bad':    status === 'err',
                    'text-accent animate-pulse-soft': status === 'running',
                }">
                {{ status === 'ok' ? '✓' : status === 'err' ? '✗' : '…' }}
            </span>
        </summary>
        <div class="border-t border-dashed border-line">
            <div v-if="command"
                class="px-3 pt-2.5 pb-2 font-mono text-[11.5px] whitespace-pre-wrap break-words leading-[1.55] text-accent/80">
                <span class="text-faint select-none">$ </span>{{ command }}
            </div>
            <div v-else-if="detail"
                class="px-3 pt-2.5 pb-2 font-mono text-[11.5px] whitespace-pre-wrap break-words leading-[1.55] text-muted">
                {{ detail }}
            </div>
            <div v-if="result !== null"
                class="px-3 pb-3 pt-2.5 font-mono text-[11.5px] whitespace-pre-wrap break-words max-h-[320px] overflow-y-auto leading-[1.55] text-muted"
                :class="{ 'border-t border-dashed border-line': command || detail }">
                {{ result }}
            </div>
            <div v-if="kind === 'agent' && subMessages.length"
                class="border-t border-dashed border-line px-3 py-2.5">
                <div class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
                    子 Agent 消息
                </div>
                <div class="flex flex-col gap-2">
                    <div v-for="message in subMessages" :key="message._key"
                        class="rounded-md border border-line bg-bg px-2.5 py-2">
                        <div class="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                            {{ message.agentName || 'agent' }} · {{ message.role }}
                        </div>
                        <pre class="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-muted">{{ summarizeSubMessage(message) }}</pre>
                    </div>
                </div>
            </div>
            <div v-if="result === null" class="px-3 pb-3 pt-2.5 font-mono text-[11.5px] text-faint">
                running…
            </div>
        </div>
    </details>
</template>

<style scoped>
.animate-pulse-soft {
    animation: pulse-soft 1.2s ease-in-out infinite;
}
</style>

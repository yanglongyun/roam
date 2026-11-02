<script setup>
// 对话顶部的一条细栏：这个会话的默认设备。草稿阶段跟随顶栏选中的设备；
// 已有会话可以在这里切换，切换后不带 device 参数的工具调用都到新设备执行。
import { computed } from 'vue';
import { useWsStore } from '@/stores/ws';
import { useAgentStore } from '@/stores/agent';

const ws = useWsStore();
const agent = useAgentStore();

const deviceId = computed(() => (agent.currentId ? agent.sessionDeviceId : ws.currentDeviceId));
const device = computed(() => ws.devices.find((item) => item.id === deviceId.value) || null);
const label = computed(() => {
    if (!deviceId.value) return ws.devices.length ? '未指定设备' : '没有设备';
    return device.value ? ws.deviceLabel(device.value) : `设备 ${deviceId.value}（已删除登记）`;
});

function onChange(event) {
    const id = event.target.value;
    if (!id) return;
    if (agent.currentId) void agent.setThreadDevice(agent.currentId, id);
    else ws.selectDevice(id);
}
</script>

<template>
    <div class="shrink-0 flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-950 px-3 py-1.5 text-[11.5px] text-zinc-500">
        <span>默认设备</span>
        <label class="relative inline-flex min-w-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 pr-5 text-zinc-300">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="device?.online ? 'bg-emerald-500' : 'bg-zinc-600'"></span>
            <span class="truncate">{{ label }}</span>
            <select class="absolute inset-0 w-full cursor-pointer opacity-0" :value="deviceId" :disabled="!ws.devices.length || agent.busy" @change="onChange">
                <option v-for="item in ws.devices" :key="item.id" :value="item.id">
                    {{ item.online ? '●' : '○' }} {{ ws.deviceLabel(item) }}
                </option>
            </select>
            <svg class="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-zinc-600" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </label>
        <span v-if="device && !device.online" class="truncate text-zinc-600">离线：工具调用会失败，可切到在线设备</span>
        <span v-else-if="device?.description" class="truncate text-zinc-600">{{ device.description }}</span>
    </div>
</template>

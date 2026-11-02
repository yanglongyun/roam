<script setup>
// 顶栏的设备选择器：终端 / 文件 / 屏幕 / 状态都对着选中的这台设备。
import { computed } from 'vue';
import { useWsStore } from '@/stores/ws';

const ws = useWsStore();

const label = computed(() => ws.deviceLabel(ws.currentDevice));

function onChange(event) {
    ws.selectDevice(event.target.value);
}
</script>

<template>
    <label class="picker relative flex h-8 max-w-[46vw] items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 pl-2 pr-6 text-xs text-zinc-200" :title="ws.statusText">
        <span class="h-2 w-2 shrink-0 rounded-full"
            :class="{
                'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]': ws.showActions && ws.desktopOnline,
                'bg-zinc-600': ws.showActions && !ws.desktopOnline,
                'bg-amber-400 pulse': (ws.state === 'pending' || ws.isReconnecting) && !ws.connectionLost,
                'bg-red-500': ws.connectionLost || (ws.state === 'offline' && !ws.isReconnecting),
            }"></span>
        <span class="truncate">{{ ws.devices.length ? label : '无设备' }}</span>
        <select class="absolute inset-0 w-full cursor-pointer opacity-0" :value="ws.currentDeviceId" @change="onChange" :disabled="!ws.devices.length">
            <option v-for="device in ws.devices" :key="device.id" :value="device.id">
                {{ device.online ? '●' : '○' }} {{ ws.deviceLabel(device) }}
            </option>
        </select>
        <svg class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </label>
</template>

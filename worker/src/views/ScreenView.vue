<script setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useWsStore } from '@/stores/ws';
import { useScreenStore } from '@/stores/screen';

const ws = useWsStore();
const screen = useScreenStore();
const text = ref('');
let clickTimer, wheelTimer, touch = null, suppressClickUntil = 0, viewActive = false;
let wheelPending = null;
const keys = [{ key: 'Enter', label: '回车' }, { key: 'Tab', label: 'Tab' }, { key: 'Backspace', label: '退格' }, { key: 'Escape', label: 'Esc' }];
const updated = computed(() => screen.frame ? new Date(screen.frame.capturedAt).toLocaleTimeString('zh-CN') : '尚未截图');
const status = computed(() => {
    if (!screen.available) return '已暂停';
    if (screen.operating) return '正在操作';
    if (screen.captureError) return '刷新已暂停';
    return screen.automatic ? '每 2 秒刷新' : '自动刷新已暂停';
});
function position(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
}
function click(event) {
    if (!screen.canControl || Date.now() < suppressClickUntil) return;
    const point = position(event);
    const frameId = screen.frame.id;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { void screen.operate({ type: 'click', ...point, button: 'left', count: 1 }, frameId); }, 220);
}
function doubleClick(event) {
    clearTimeout(clickTimer);
    if (screen.canControl) void screen.operate({ type: 'click', ...position(event), button: 'left', count: 2 });
}
function contextMenu(event) {
    event.preventDefault();
    clearTimeout(clickTimer);
    if (screen.canControl) void screen.operate({ type: 'click', ...position(event), button: 'right', count: 1 });
}
function flushWheel() {
    clearTimeout(wheelTimer);
    if (!wheelPending) return;
    if (!screen.available) { wheelPending = null; return; }
    if (screen.operating) { wheelTimer = setTimeout(flushWheel, 100); return; }
    const { frameId, ...input } = wheelPending;
    wheelPending = null;
    if (screen.canControl) void screen.operate(input, frameId);
}
function scroll(point, deltaX, deltaY, frameId = screen.frame?.id) {
    const previous = wheelPending || { deltaX: 0, deltaY: 0 };
    const clamp = (value) => Math.max(-1200, Math.min(1200, value));
    wheelPending = { type: 'scroll', ...point, frameId, deltaX: clamp(previous.deltaX + deltaX), deltaY: clamp(previous.deltaY + deltaY) };
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(flushWheel, 100);
}
function wheel(event) {
    if (!screen.frame?.control?.allowed || !screen.available) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 500 : 1;
    scroll(position(event), event.deltaX * scale, event.deltaY * scale);
}
function pointerDown(event) {
    if (event.pointerType !== 'touch' || !screen.canControl) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY, point: position(event), frameId: screen.frame.id };
}
function pointerUp(event) {
    if (!touch || touch.id !== event.pointerId) return;
    const gesture = touch;
    touch = null;
    suppressClickUntil = Date.now() + 500;
    const dx = gesture.x - event.clientX, dy = gesture.y - event.clientY;
    if (Math.hypot(dx, dy) > 12) scroll(gesture.point, dx, dy, gesture.frameId);
    else void screen.operate({ type: 'click', ...gesture.point, button: 'left', count: 1 }, gesture.frameId);
}
async function sendText() {
    if (!text.value || !screen.canControl) return;
    const value = text.value;
    if (await screen.operate({ type: 'text', text: value }) && text.value === value) text.value = '';
}
function key(key, modifiers = []) { void screen.operate({ type: 'key', key, modifiers }); }
function cancelGestures() {
    clearTimeout(clickTimer); clearTimeout(wheelTimer);
    touch = null; wheelPending = null;
}
function visibility() { if (document.hidden) cancelGestures(); screen.setVisible(!document.hidden); }
function activate() { viewActive = true; visibility(); screen.start(); }
function deactivate() { viewActive = false; cancelGestures(); screen.stop(); }
function pagehide() { cancelGestures(); screen.stop(); }
function pageshow() { if (viewActive) activate(); }
onMounted(() => { document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pagehide); window.addEventListener('pageshow', pageshow); activate(); });
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', pageshow); deactivate(); });
watch(() => ws.currentDeviceId, () => { cancelGestures(); text.value = ''; });
watch(() => screen.available, (ready) => { if (!ready) cancelGestures(); });
</script>

<template>
    <div class="screen-app">
        <div class="screen-toolbar">
            <div class="screen-live" role="status"><i :class="{ running: screen.available && screen.automatic && !screen.captureError }"></i>{{ status }}</div>
            <div class="screen-toolbar-actions">
                <button :disabled="!screen.available || screen.operating || screen.capturing" @click="screen.refresh()">{{ screen.capturing ? '截图中…' : '刷新' }}</button>
                <button :disabled="!ws.canUseActions" @click="screen.setAutomatic(!screen.automatic)">{{ screen.automatic ? '暂停刷新' : '恢复刷新' }}</button>
            </div>
        </div>
        <div v-if="screen.frame?.control?.supported && !screen.frame.control.allowed" class="screen-permission" role="status">
            <span>需要允许控制这台电脑，才能点击和输入。</span>
            <button :disabled="!screen.available || screen.operating" @click="screen.permission()">打开权限设置</button>
        </div>
        <div v-else-if="screen.frame && !screen.frame.control.supported" class="screen-permission">当前设备支持查看屏幕，暂不支持远程操作。</div>
        <div v-if="screen.captureError || screen.inputError" class="screen-error" role="alert">
            <span>{{ screen.captureError || screen.inputError }}</span>
            <button :disabled="!screen.available || screen.operating || screen.capturing" @click="screen.refresh()">重新刷新</button>
        </div>
        <main class="screen-canvas">
            <div v-if="!ws.desktopOnline" class="screen-empty">{{ ws.devices.length ? `${ws.deviceLabel(ws.currentDevice)} 离线` : '还没有设备接入' }}</div>
            <figure v-else-if="screen.frame" class="screen-frame" :style="{ maxWidth: `${screen.frame.width}px` }">
                <img :src="screen.frame.url" alt="远程桌面" draggable="false"
                    :class="{ controllable: screen.canControl }"
                    @click="click" @dblclick="doubleClick" @contextmenu="contextMenu" @wheel="wheel"
                    @pointerdown="pointerDown" @pointerup="pointerUp" @pointercancel="touch = null" />
            </figure>
            <div v-else class="screen-empty">{{ screen.capturing ? '正在获取桌面截图…' : screen.captureError ? '截图未完成' : '等待设备连接' }}</div>
        </main>
        <div v-if="screen.frame" class="screen-caption">
            <span>{{ screen.frame.control.allowed ? '点击操作 · 滚轮滚动 · 手机上滑动滚动' : '桌面画面' }}</span>
            <time>{{ updated }} · {{ screen.frame.width }} × {{ screen.frame.height }}</time>
        </div>
        <form class="screen-input" @submit.prevent="sendText">
            <div class="screen-keybar">
                <button v-for="item in keys" :key="item.key" type="button" :disabled="!screen.canControl" @click="key(item.key)">{{ item.label }}</button>
                <button type="button" :disabled="!screen.canControl" @click="key('a', ['meta'])">全选</button>
            </div>
            <div class="screen-text-row">
                <textarea v-model="text" rows="1" maxlength="10000" aria-label="输入到电脑" placeholder="输入到电脑…" :disabled="!screen.frame?.control?.allowed || !screen.available" @keydown.meta.enter.prevent="sendText" @keydown.ctrl.enter.prevent="sendText"></textarea>
                <button type="submit" class="screen-send" :disabled="!screen.canControl || !text">{{ screen.operating ? '操作中…' : '输入' }}</button>
            </div>
        </form>
    </div>
</template>

<style scoped>
.screen-app { display: flex; flex: 1; min-height: 0; flex-direction: column; background: var(--color-bg); }
.screen-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--color-line); flex-shrink: 0; }
.screen-live { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--color-muted); white-space: nowrap; }
.screen-live i { width: 6px; height: 6px; border-radius: 50%; background: var(--color-faint); }
.screen-live i.running { background: var(--color-accent); }
.screen-toolbar-actions { display: flex; gap: 8px; }
button { padding: 7px 11px; border: 1px solid var(--color-line-hi); border-radius: 7px; color: var(--color-ink); font-size: 12px; white-space: nowrap; }
button:hover:not(:disabled) { background: var(--color-bg-elev); }
button:disabled { opacity: .4; cursor: not-allowed; }
.screen-permission, .screen-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 16px; border-bottom: 1px solid var(--color-line); color: var(--color-muted); font-size: 12px; line-height: 1.6; flex-shrink: 0; }
.screen-permission button, .screen-error button { flex-shrink: 0; }
.screen-error { color: var(--color-bad); }
.screen-canvas { display: flex; align-items: center; justify-content: center; flex: 1; min-height: 0; overflow: hidden; padding: 16px; background: #080807; }
.screen-frame { display: flex; align-items: center; justify-content: center; margin: 0 auto; width: 100%; height: 100%; min-height: 0; }
.screen-frame img { display: block; width: auto; height: auto; max-width: 100%; max-height: 100%; outline: 1px solid var(--color-line); border-radius: 6px; user-select: none; -webkit-user-drag: none; }
.screen-frame img.controllable { cursor: crosshair; touch-action: pinch-zoom; }
.screen-empty { height: 100%; min-height: 120px; display: flex; align-items: center; justify-content: center; color: var(--color-muted); font-size: 13px; }
.screen-caption { display: flex; justify-content: space-between; gap: 12px; padding: 7px 16px; color: var(--color-faint); font-size: 11px; flex-shrink: 0; }
.screen-caption time { white-space: nowrap; }
.screen-input { padding: 10px 16px max(12px, env(safe-area-inset-bottom)); border-top: 1px solid var(--color-line); flex-shrink: 0; }
.screen-keybar { display: flex; gap: 6px; margin-bottom: 9px; overflow-x: auto; }
.screen-keybar button { padding: 5px 11px; color: var(--color-muted); }
.screen-text-row { display: flex; align-items: flex-end; gap: 8px; }
textarea { width: 100%; min-width: 0; min-height: 38px; max-height: 120px; resize: vertical; border: 1px solid var(--color-line-hi); border-radius: 8px; padding: 9px 11px; color: var(--color-ink); background: var(--color-bg-elev); outline: none; font-size: 14px; line-height: 1.5; }
textarea:focus { border-color: var(--color-accent); }
.screen-send { height: 40px; padding: 8px 18px; background: var(--color-accent); border-color: transparent; color: var(--color-bg); }
.screen-send:hover:not(:disabled) { background: var(--color-accent); opacity: .9; }
@media (max-width: 600px) { .screen-toolbar, .screen-input { padding-left: 12px; padding-right: 12px; } .screen-canvas { padding: 8px; } .screen-caption { flex-wrap: wrap; gap: 3px; padding: 6px 12px; } .screen-permission, .screen-error { padding: 8px 12px; } }
</style>

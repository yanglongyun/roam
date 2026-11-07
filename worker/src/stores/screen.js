import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { useWsStore } from './ws';

export const useScreenStore = defineStore('screen', () => {
    const ws = useWsStore();
    const active = ref(false);
    const visible = ref(true);
    const automatic = ref(true);
    const frame = ref(null);
    const capturing = ref(false);
    const operating = ref(false);
    const captureError = ref('');
    const inputError = ref('');
    let inputErrorCode = '';
    const pending = new Map();
    let timer, generation = 0, captureController = null, inputController = null;
    const available = computed(() => active.value && visible.value && ws.canUseActions);
    const canControl = computed(() => available.value && frame.value?.control?.allowed
        && frame.value.generation === generation && frame.value.clientId === ws.clientId && !captureError.value && !operating.value);

    ws.onMessage('screen.result', (message) => {
        const entry = pending.get(message.data?.reqId);
        if (!entry || message.meta?.deviceId !== entry.device) return;
        if (message.data.ok) entry.finish(null, message.data);
        else entry.finish(Object.assign(new Error(message.data.error || '屏幕操作失败'), { code: message.data.code }));
    });
    function request(action, data, signal) {
        const device = ws.currentDeviceId;
        return new Promise((resolve, reject) => {
            const reqId = crypto.randomUUID();
            const cancel = () => {
                ws.sendMsg({ type: 'screen.cancel', to: `device:${device}`, data: { reqId } });
                finish(signal.reason || new DOMException('操作已取消', 'AbortError'));
            };
            const finish = (error, value) => {
                if (!pending.delete(reqId)) return;
                clearTimeout(timeout);
                signal.removeEventListener('abort', cancel);
                if (error) reject(error); else resolve(value);
            };
            const timeout = setTimeout(() => {
                ws.sendMsg({ type: 'screen.cancel', to: `device:${device}`, data: { reqId } });
                finish(new Error('屏幕响应超时，请重试'));
            }, 35000);
            pending.set(reqId, { device, finish });
            signal.addEventListener('abort', cancel, { once: true });
            if (signal.aborted) { cancel(); return; }
            if (!ws.sendMsg({ type: 'screen.request', to: `device:${device}`, data: { reqId, action, ...data } })) finish(new Error('设备未连接'));
        });
    }
    function schedule(delay = 2000) {
        clearTimeout(timer);
        if (available.value && automatic.value && !captureError.value && !operating.value) timer = setTimeout(() => { void refresh(); }, delay);
    }
    function abortCapture() {
        captureController?.abort();
        captureController = null;
        capturing.value = false;
    }
    async function refresh() {
        clearTimeout(timer);
        if (!available.value || capturing.value || operating.value) return false;
        const mine = generation;
        const controller = new AbortController();
        captureController = controller;
        capturing.value = true;
        captureError.value = '';
        const started = Date.now();
        let url;
        try {
            const result = await request('capture', {}, controller.signal);
            const bytes = Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0));
            url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
            const image = new Image();
            image.src = url;
            await image.decode();
            if (mine !== generation || controller.signal.aborted || !available.value) return false;
            const old = frame.value?.url;
            frame.value = { id: result.frameId, url, capturedAt: result.capturedAt, control: result.control, generation: mine, clientId: ws.clientId,
                width: image.naturalWidth, height: image.naturalHeight };
            if (inputErrorCode === 'STALE_FRAME' || (inputErrorCode === 'CONTROL_PERMISSION' && result.control.allowed)) {
                inputError.value = ''; inputErrorCode = '';
            }
            url = null;
            if (old) URL.revokeObjectURL(old);
            return true;
        } catch (error) {
            if (mine === generation && !controller.signal.aborted) captureError.value = error.message || '截图失败，请重试';
            return false;
        } finally {
            if (url) URL.revokeObjectURL(url);
            if (captureController === controller) {
                captureController = null;
                capturing.value = false;
                schedule(Math.max(200, 2000 - (Date.now() - started)));
            }
        }
    }
    async function operate(input, frameId = frame.value?.id) {
        if (!canControl.value) return false;
        clearTimeout(timer);
        abortCapture();
        const mine = generation;
        const controller = new AbortController();
        inputController = controller;
        operating.value = true;
        inputError.value = '';
        inputErrorCode = '';
        try {
            await request('input', { frameId, input }, controller.signal);
            return mine === generation && !controller.signal.aborted;
        } catch (error) {
            if (mine === generation && !controller.signal.aborted) {
                inputError.value = error.message || '操作失败';
                inputErrorCode = error.code || '';
                if (error.code === 'CONTROL_PERMISSION') frame.value.control.allowed = false;
            }
            return false;
        } finally {
            if (inputController === controller) {
                inputController = null;
                operating.value = false;
                // 操作后的截图不受自动刷新开关影响。
                if (mine === generation && available.value) timer = setTimeout(() => { void refresh(); }, 250);
            }
        }
    }
    async function permission() {
        if (!available.value || operating.value) return;
        const controller = new AbortController();
        inputController = controller;
        operating.value = true;
        inputError.value = '';
        try { await request('permission', {}, controller.signal); }
        catch (error) { if (!controller.signal.aborted) inputError.value = error.message; }
        finally {
            if (inputController === controller) { inputController = null; operating.value = false; void refresh(); }
        }
    }
    function halt() {
        generation++;
        clearTimeout(timer);
        abortCapture();
        inputController?.abort();
        inputController = null;
        operating.value = false;
    }
    function clearFrame() {
        if (frame.value) URL.revokeObjectURL(frame.value.url);
        frame.value = null;
        captureError.value = '';
        inputError.value = '';
        inputErrorCode = '';
    }
    function start() { active.value = true; }
    function stop() { active.value = false; halt(); }
    function setVisible(value) { visible.value = value; }
    function setAutomatic(value) { automatic.value = value; if (value) void refresh(); else clearTimeout(timer); }
    watch(() => [available.value, ws.currentDeviceId], ([ready, device], previous) => {
        halt();
        if (device !== previous?.[1]) clearFrame();
        if (ready) void refresh();
    }, { flush: 'sync' });

    return { active, visible, automatic, frame, capturing, operating, captureError, inputError, available, canControl,
        start, stop, setVisible, setAutomatic, refresh, operate, permission };
});

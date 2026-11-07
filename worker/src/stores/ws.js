import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

const DISCONNECT_GRACE_MS = 10000;
const TOKEN_KEY = 'roam_auth';
const DEVICE_KEY = 'roam_device';

export const useWsStore = defineStore('ws', () => {
    const clientId = ref('');
    const state = ref('pending');
    const statusText = ref('连接中...');
    const authenticated = ref(false);
    const passwordSet = ref(true);
    const authError = ref('');
    const authClosed = ref(false);
    const disconnectedSince = ref(0);
    const disconnectGraceExpired = ref(false);

    // 已登记的设备（云端推送），以及网页当前操作的设备：终端 / 文件 / 屏幕 / 状态都对着它。
    const devices = ref([]);
    const currentDeviceId = ref(readDevice());

    const handlers = new Map();
    let ws = null;
    let reconnectTimer = null;
    let disconnectGraceTimer = null;

    const connectionLost = computed(() => Boolean(disconnectedSince.value && disconnectGraceExpired.value));
    const isReconnecting = computed(() => Boolean(disconnectedSince.value && !connectionLost.value));
    const showActions = computed(() => state.value === 'connected' && authenticated.value);
    const currentDevice = computed(() => devices.value.find((device) => device.id === currentDeviceId.value) || null);
    const onlineDevices = computed(() => devices.value.filter((device) => device.online));
    const desktopOnline = computed(() => Boolean(currentDevice.value?.online));
    const canUseActions = computed(() => showActions.value && desktopOnline.value);

    function readToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
    }
    function writeToken(t) {
        try {
            if (t) localStorage.setItem(TOKEN_KEY, t);
            else localStorage.removeItem(TOKEN_KEY);
        } catch {}
    }
    function invalidateAuth(token) {
        // 较早的 HTTP 请求失败，不能清掉用户刚重新登录得到的新令牌。
        if (token !== readToken()) return;
        writeToken('');
        authenticated.value = false;
        authError.value = '登录已过期，请重新输入访问密码';
    }
    function readDevice() {
        try { return localStorage.getItem(DEVICE_KEY) || ''; } catch { return ''; }
    }
    function writeDevice(id) {
        try {
            if (id) localStorage.setItem(DEVICE_KEY, id);
            else localStorage.removeItem(DEVICE_KEY);
        } catch {}
    }

    function deviceLabel(device) {
        if (!device) return '未选择设备';
        return device.name || device.host || device.id;
    }

    function selectDevice(id) {
        if (!id || id === currentDeviceId.value) return;
        currentDeviceId.value = id;
        writeDevice(id);
    }

    // 设备列表更新后：当前选中的不在列表里（或从没选过）就挑在线的第一台。
    watch(devices, (list) => {
        if (list.some((device) => device.id === currentDeviceId.value)) return;
        const pick = list.find((device) => device.online) || list[0];
        currentDeviceId.value = pick?.id || '';
        writeDevice(currentDeviceId.value);
    });

    function updateStatusText() {
        if (!devices.value.length) {
            statusText.value = '没有设备接入';
            return;
        }
        const label = deviceLabel(currentDevice.value);
        statusText.value = desktopOnline.value ? `${label} 已连接` : `${label} 离线`;
    }
    watch([currentDevice, desktopOnline], updateStatusText);

    function onMessage(type, handler) {
        handlers.set(type, handler);
        return () => handlers.delete(type);
    }

    function sendMsg(msg) {
        if (ws?.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(msg));
        return true;
    }

    // 发给当前选中的设备（终端 / 文件 / 屏幕 / 状态）。
    function sendToDevice(type, data = {}) {
        if (!currentDeviceId.value) return false;
        return sendMsg({ type, to: `device:${currentDeviceId.value}`, data });
    }

    function submitPassword(password) {
        authError.value = '';
        if (authClosed.value) {
            authError.value = '认证已锁定，请稍后刷新重试';
            return;
        }
        if (!sendMsg({ type: 'auth.submit', to: 'hub', data: { password: String(password || '') } })) {
            authError.value = '尚未连上云端，请稍候再试';
        }
    }

    function init() {
        connect();
        window.addEventListener('beforeunload', () => ws?.close());
        return true;
    }

    function connect() {
        clearTimeout(reconnectTimer);
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams({ device: 'web' });
        const savedToken = readToken();
        if (savedToken) params.set('authToken', savedToken);
        const url = `${protocol}//${location.host}/ws?${params.toString()}`;

        state.value = 'pending';
        statusText.value = connectionLost.value
            ? '连接已断开，重连中...'
            : (disconnectedSince.value ? '重连中...' : '连接中...');
        ws = new WebSocket(url);

        ws.onopen = () => {
            state.value = 'pending';
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'connection.ready') {
                    clientId.value = msg.data?.clientId || '';
                    authenticated.value = Boolean(msg.data?.authenticated);
                    passwordSet.value = msg.data?.passwordSet !== false;
                    if (!passwordSet.value) authClosed.value = true;
                }
                if (msg.type === 'auth.state') {
                    authenticated.value = Boolean(msg.data?.authenticated);
                    authError.value = msg.data?.error || '';
                    if (msg.data?.closed) {
                        authClosed.value = true;
                        writeToken('');  // 被锁或没设密码：丢弃本地令牌
                    }
                    if (msg.data?.sessionToken) {
                        writeToken(String(msg.data.sessionToken));
                    }
                }
                if (msg.type === 'connection.devices' && Array.isArray(msg.data?.devices)) {
                    devices.value = msg.data.devices;
                    updateStatusText();
                }
                if (msg.type === 'auth.state' || msg.type === 'connection.ready') {
                    // 连上云端就能用：对话、配置、消息都在云端，设备只负责执行。
                    state.value = 'connected';
                    disconnectedSince.value = 0;
                    disconnectGraceExpired.value = false;
                    clearTimeout(disconnectGraceTimer);
                    if (!authenticated.value) {
                        statusText.value = passwordSet.value ? '等待登录' : '未设置访问密码';
                    } else {
                        updateStatusText();
                    }
                }
                // 来自设备的消息带 meta.deviceId；不是当前设备的直接忽略，各视图只看选中的那台。
                if (msg.meta?.deviceId && msg.meta.deviceId !== currentDeviceId.value) return;
                handlers.get(msg.type)?.(msg);
            } catch (e) {
                console.error('处理消息失败:', e);
            }
        };

        ws.onclose = (event) => {
            state.value = 'offline';
            if (event?.code === 4003 || authClosed.value) {
                authenticated.value = false;
                disconnectedSince.value = 0;
                disconnectGraceExpired.value = false;
                clearTimeout(disconnectGraceTimer);
                statusText.value = passwordSet.value ? '认证已锁定' : '未设置访问密码';
                writeToken('');
                return;
            }
            if (!disconnectedSince.value) {
                disconnectedSince.value = Date.now();
                disconnectGraceExpired.value = false;
            }
            statusText.value = '重连中...';
            clearTimeout(disconnectGraceTimer);
            const remainingGraceMs = DISCONNECT_GRACE_MS - (Date.now() - disconnectedSince.value);
            if (remainingGraceMs <= 0) {
                disconnectGraceExpired.value = true;
                statusText.value = '连接已断开，重连中...';
            } else {
                disconnectGraceTimer = setTimeout(() => {
                    if (state.value !== 'offline') return;
                    disconnectGraceExpired.value = true;
                    statusText.value = '连接已断开，重连中...';
                }, remainingGraceMs);
            }
            reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
            state.value = 'offline';
            if (!disconnectedSince.value) {
                disconnectedSince.value = Date.now();
                disconnectGraceExpired.value = false;
            }
            statusText.value = '重连中...';
        };
    }

    return {
        clientId, state, statusText, showActions, desktopOnline,
        authenticated, passwordSet, authError, authClosed,
        disconnectedSince, isReconnecting, connectionLost, canUseActions,
        devices, currentDeviceId, currentDevice, onlineDevices, deviceLabel, selectDevice,
        init, sendMsg, sendToDevice, onMessage, submitPassword, getAuthToken: readToken, invalidateAuth,
    };
});

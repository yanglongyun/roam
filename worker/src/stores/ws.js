import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useWsStore = defineStore('ws', () => {
    const sessionId = ref(null);
    const clientId = ref('');
    const state = ref('pending');
    const statusText = ref('连接中...');
    const showActions = ref(false);
    const invalid = ref(false);
    const authenticated = ref(false);
    const requiresPassword = ref(false);
    const authError = ref('');
    const authClosed = ref(false);
    const superseded = ref(false);

    const handlers = new Map();
    let ws = null;
    let reconnectTimer = null;
    let challengeNonce = '';
    let lastChallengeReqAt = 0;

    function tokenKey() { return `meem_auth_${sessionId.value || ''}`; }
    function readToken() {
        try { return localStorage.getItem(tokenKey()) || ''; } catch { return ''; }
    }
    function writeToken(t) {
        try {
            if (t) localStorage.setItem(tokenKey(), t);
            else localStorage.removeItem(tokenKey());
        } catch {}
    }

    function onMessage(type, handler) {
        handlers.set(type, handler);
        return () => handlers.delete(type);
    }

    function sendMsg(msg) {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    }

    function requestChallenge() {
        // 最多每 500ms 重发一次，避免刷爆
        const now = Date.now();
        if (now - lastChallengeReqAt < 500) return;
        lastChallengeReqAt = now;
        sendMsg({ type: 'auth.request_challenge', to: 'desktop', data: {} });
    }

    async function waitForChallenge(timeoutMs = 2500) {
        const start = Date.now();
        while (!challengeNonce && Date.now() - start < timeoutMs) {
            if (authClosed.value || superseded.value) return false;
            requestChallenge();
            await new Promise((r) => setTimeout(r, 200));
        }
        return Boolean(challengeNonce);
    }

    async function hmacHex(password, nonceHex) {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const nonceBytes = hexToBytes(nonceHex);
        const sig = await crypto.subtle.sign('HMAC', key, nonceBytes);
        return bytesToHex(new Uint8Array(sig));
    }

    function hexToBytes(hex) {
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++) {
            out[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return out;
    }

    function bytesToHex(bytes) {
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function submitPassword(password) {
        authError.value = '';
        if (authClosed.value) {
            authError.value = '认证已锁定';
            return;
        }
        if (!challengeNonce) {
            const ok = await waitForChallenge();
            if (!ok) {
                authError.value = authClosed.value ? '认证已锁定' : '客户端未就绪，请稍候再试';
                return;
            }
        }
        try {
            const proof = await hmacHex(String(password || ''), challengeNonce);
            sendMsg({ type: 'auth.submit', to: 'desktop', data: { proof } });
        } catch (err) {
            authError.value = err?.message || '本地签名失败';
        }
    }

    function init() {
        const s = new URLSearchParams(location.search).get('session');
        if (!s || s === 'default') {
            invalid.value = true;
            state.value = 'offline';
            statusText.value = '无效的访问链接';
            return false;
        }
        sessionId.value = s;
        connect();
        window.addEventListener('beforeunload', () => ws?.close());
        return true;
    }

    function connect() {
        clearTimeout(reconnectTimer);
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams({ session: sessionId.value, device: 'web' });
        const savedToken = readToken();
        if (savedToken) params.set('authToken', savedToken);
        const url = `${protocol}//${location.host}/ws?${params.toString()}`;

        state.value = 'pending';
        statusText.value = '连接中...';
        challengeNonce = '';
        lastChallengeReqAt = 0;
        ws = new WebSocket(url);

        ws.onopen = () => {
            state.value = 'pending';
            statusText.value = '等待客户端...';
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'connection.ready') {
                    clientId.value = msg.data?.clientId || '';
                    authenticated.value = Boolean(msg.data?.authenticated);
                    requiresPassword.value = Boolean(msg.data?.requiresPassword);
                }
                if (msg.type === 'auth.state') {
                    authenticated.value = Boolean(msg.data?.authenticated);
                    requiresPassword.value = Boolean(msg.data?.requiresPassword);
                    authError.value = msg.data?.error || '';
                    if (msg.data?.closed) {
                        authClosed.value = true;
                        writeToken('');  // 被锁：丢弃本地 token
                    }
                    if (msg.data?.kicked) {
                        superseded.value = true;
                    }
                    if (msg.data?.sessionToken) {
                        writeToken(String(msg.data.sessionToken));
                    }
                }
                if (msg.type === 'auth.challenge' && msg.data?.nonce) {
                    challengeNonce = String(msg.data.nonce);
                }
                if (msg.type === 'connection.devices' && msg.data?.devices) {
                    const d = msg.data.devices;
                    if (d.desktop === 'connected') {
                        state.value = 'connected';
                        statusText.value = '已连接到客户端';
                        showActions.value = authenticated.value || !requiresPassword.value;
                        if (!authenticated.value && requiresPassword.value && !challengeNonce) {
                            requestChallenge();
                        }
                    } else {
                        state.value = 'pending';
                        statusText.value = '等待客户端连接...';
                        showActions.value = false;
                    }
                }
                if (msg.type === 'auth.state' || msg.type === 'connection.ready') {
                    showActions.value = state.value === 'connected' && (authenticated.value || !requiresPassword.value);
                    if (!authenticated.value && requiresPassword.value && !challengeNonce && !authClosed.value && state.value === 'connected') {
                        requestChallenge();
                    }
                }
                handlers.get(msg.type)?.(msg);
            } catch (e) {
                console.error('处理消息失败:', e);
            }
        };

        ws.onclose = (event) => {
            state.value = 'offline';
            authenticated.value = false;
            showActions.value = false;
            challengeNonce = '';
            lastChallengeReqAt = 0;
            if (event?.code === 4003 || authClosed.value) {
                statusText.value = '认证已锁定';
                writeToken('');
                return;
            }
            if (event?.code === 4001 || superseded.value) {
                superseded.value = true;
                statusText.value = '已在另一台设备登录';
                return;
            }
            statusText.value = '连接已断开，3 秒后重连...';
            reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
            state.value = 'offline';
            statusText.value = '连接错误';
            showActions.value = false;
        };
    }

    return {
        sessionId, clientId, state, statusText, showActions, invalid,
        authenticated, requiresPassword, authError, authClosed, superseded,
        init, sendMsg, onMessage, submitPassword,
    };
});

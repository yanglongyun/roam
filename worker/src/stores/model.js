import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useWsStore } from '@/stores/ws';

// 模型配置以电脑端（~/.roam/roam.db 的 settings 表）为唯一真相，经 WS 的 model.get/set 读写。
// 返回的 config 是安全视图：不含明文 key，只有 hasKey + keyPreview。
export const useModelStore = defineStore('model', () => {
    const ws = useWsStore();
    const config = ref({ baseUrl: '', model: '', system: '', contextTurns: 100, hasKey: false, keyPreview: '' });
    const loaded = ref(false);

    const pending = new Map();
    let seq = 0;
    let bound = false;

    function request(type, data = {}) {
        return new Promise((resolve) => {
            const reqId = `m${Date.now()}_${seq++}`;
            pending.set(reqId, resolve);
            const ok = ws.sendMsg({ type, to: 'desktop', data: { ...data, reqId } });
            if (!ok) { pending.delete(reqId); resolve(null); return; }
            setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); resolve(null); } }, 15000);
        });
    }
    function onResult(msg) {
        const d = msg.data || {};
        const r = d.reqId && pending.get(d.reqId);
        if (r) { pending.delete(d.reqId); r(d); }
    }
    function bind() {
        if (bound) return;
        bound = true;
        ws.onMessage('model.get.result', onResult);
        ws.onMessage('model.set.result', onResult);
    }

    async function load() {
        bind();
        const d = await request('model.get');
        if (d?.config) { config.value = d.config; loaded.value = true; }
        return config.value;
    }
    async function save(patch) {
        bind();
        const d = await request('model.set', { config: patch });
        if (d?.config) { config.value = d.config; loaded.value = true; }
        return config.value;
    }

    return { config, loaded, load, save };
});

<script setup>
import { computed, ref } from 'vue';
import { useConversation } from '@/lib/agent/conversation';
import { useWsStore } from '@/stores/ws';
import { useToastStore } from '@/stores/toast';
import Icon from './Icon.vue';

const agent = useConversation();
const ws = useWsStore();
const toast = useToastStore();

const text = computed({
    get: () => agent.drafts[agent.currentId || '__draft__'] || '',
    set: (value) => { agent.drafts[agent.currentId || '__draft__'] = value; },
});
const images = ref([]); // [{ name, url(Data URL) }]
const reading = ref(false);
const taRef = ref(null);
const fileRef = ref(null);
let imageVersion = 0;

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// 任务会话里发话 = 追加指令，任务正在跑也能发。
const steering = computed(() => Boolean(agent.currentTask));
const canSend = computed(() => ws.showActions && agent.ready && (!agent.busy || steering.value) && !reading.value
    && (text.value.trim().length > 0 || images.value.length > 0));
// Worker 没绑 R2 时不能收发图片：藏起按钮，粘贴图片给个提示。任务会话只收文字指令。
const imagesOff = computed(() => agent.status?.images === false || steering.value);
const hint = computed(() => {
    if (!ws.showActions) return '等待连接…';
    if (steering.value) return '给这个任务追加指令，回车发送';
    if (agent.kind === 'assistant') return '告诉助理要做什么，回车发送';
    return '发消息，回车发送，Shift+回车换行';
});

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function addFiles(files) {
    if (!files.length) return;
    if (imagesOff.value) {
        toast.show('这个部署没有绑定 R2，不能发送图片');
        return;
    }
    if (images.value.length + files.length > 5) {
        toast.show('每条消息最多发送 5 张图片');
        return;
    }
    for (const file of files) {
        if (!TYPES.includes(file.type)) {
            toast.show('仅支持 PNG、JPEG、GIF、WebP 图片');
            return;
        }
        if (!file.size || file.size > 10 * 1024 * 1024) {
            toast.show('图片不能为空，且每张不能超过 10 MiB');
            return;
        }
    }
    const version = imageVersion;
    reading.value = true;
    try {
        const loaded = await Promise.all(files.map(async (file) => ({ name: file.name, url: await readFile(file) })));
        if (imageVersion === version) images.value = [...images.value, ...loaded];
    } catch {
        if (imageVersion === version) toast.show('图片读取失败');
    } finally {
        if (imageVersion === version) reading.value = false;
    }
}

function onPick(event) {
    void addFiles([...(event.target.files || [])]);
    event.target.value = '';
}

function onPaste(event) {
    const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'));
    if (files.length) {
        event.preventDefault();
        void addFiles(files);
    }
}

function removeImage(index) {
    images.value = images.value.filter((_, i) => i !== index);
}

function onKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
    }
}

function submit() {
    if (!canSend.value) return;
    if (agent.send(text.value, null, images.value.map((image) => image.url))) {
        text.value = '';
        imageVersion++;
        images.value = [];
        reading.value = false;
        if (taRef.value) taRef.value.style.height = 'auto';
    }
}

function autoGrow(event) {
    const el = event.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}
</script>

<template>
    <div class="composer safe-bottom">
        <div class="composer-box">
            <div v-if="images.length" class="composer-images">
                <div v-for="(image, index) in images" :key="index" class="composer-image">
                    <img :src="image.url" :alt="image.name" />
                    <button title="移除" @click="removeImage(index)">✕</button>
                </div>
            </div>
            <textarea
                ref="taRef"
                v-model="text"
                rows="1"
                :placeholder="hint"
                :disabled="!ws.showActions"
                @keydown="onKeydown"
                @input="autoGrow"
                @paste="onPaste"
            ></textarea>
            <div class="composer-bar">
                <input ref="fileRef" type="file" hidden multiple accept="image/png,image/jpeg,image/gif,image/webp" @change="onPick" />
                <button v-if="!imagesOff" class="tool-btn" title="添加图片（最多 5 张）"
                    :disabled="agent.busy || reading || images.length === 5 || !ws.showActions"
                    @click="fileRef?.click()">
                    <Icon name="image" :size="18" />
                </button>
                <span v-if="images.length" class="model-tag">{{ images.length }}/5</span>
                <span v-if="agent.status?.model" class="model-tag" :title="agent.status.workdir">{{ agent.status.model }}</span>
                <span v-if="agent.status?.browser_connected" class="model-tag" title="浏览器插件已连接">浏览器</span>
                <button v-if="agent.busy" class="send-btn stop" :disabled="agent.stopping" title="停止" @click="agent.stopRun()">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                </button>
                <button v-if="!agent.busy || steering" class="send-btn" :disabled="!canSend" title="发送" @click="submit">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5 M5 12l7-7 7 7" /></svg>
                </button>
            </div>
        </div>
    </div>
</template>

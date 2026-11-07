<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useTasksStore } from '@/stores/tasks';
import { useWsStore } from '@/stores/ws';
import { useAgentClientStore } from '@/stores/agent-client';
import { TASK_TITLE_MAX, TASK_GOAL_MAX } from '../../../shared/tasks.js';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['close', 'created']);
const tasks = useTasksStore();
const ws = useWsStore();
const client = useAgentClientStore();
const router = useRouter();
const title = ref('');
const goal = ref('');
const deviceId = ref('');
const workdir = ref('');
const steps = ref('');
const minutes = ref('');
const cost = ref('');
const creating = ref(false);
const error = ref('');
const titleInput = ref(null);
const devices = computed(() => ws.devices.filter((device) => device.online));
const selectedDevice = computed(() => devices.value.find((device) => device.id === deviceId.value));
const canCreate = computed(() => ws.showActions && client.status?.model_ready && selectedDevice.value
    && title.value.trim().length > 0 && [...title.value.trim()].length <= TASK_TITLE_MAX
    && goal.value.trim().length > 0 && goal.value.trim().length <= TASK_GOAL_MAX && !creating.value);

function selectDevice() {
    if (!devices.value.some((device) => device.id === deviceId.value)) {
        deviceId.value = devices.value.length === 1 ? devices.value[0].id : '';
    }
}
watch(() => devices.value.map((device) => device.id).join(','), selectDevice);
watch(() => props.open, async (open) => {
    if (!open) return;
    error.value = '';
    selectDevice();
    await nextTick();
    titleInput.value?.focus();
});

function close() { if (!creating.value) emit('close'); }
function settings() { close(); router.push('/settings'); }

async function submit() {
    if (!canCreate.value) return;
    error.value = '';
    const budget = {};
    for (const [key, raw, minimum] of [['steps', steps.value, 1], ['minutes', minutes.value, 1], ['cost', cost.value, 0.01]]) {
        if (raw === '') continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < minimum || (key === 'steps' && !Number.isSafeInteger(value))) {
            error.value = '请填写有效的执行上限，步数必须是正整数。';
            return;
        }
        budget[key] = value;
    }
    creating.value = true;
    try {
        const id = await tasks.create({
            title: title.value.trim(), goal: goal.value.trim(), device: deviceId.value,
            ...(workdir.value.trim() ? { workdir: workdir.value.trim() } : {}),
            ...(Object.keys(budget).length ? { budget } : {}),
        });
        title.value = ''; goal.value = '';
        workdir.value = '';
        steps.value = '';
        minutes.value = '';
        cost.value = '';
        emit('created', id);
    } catch (err) {
        error.value = err.message || '创建任务失败';
    } finally {
        creating.value = false;
    }
}
</script>

<template>
    <div v-if="open" class="new-task-overlay" @click.self="close" @keydown.esc="close">
        <section class="new-task-panel" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
            <header>
                <h2 id="new-task-title">新建任务</h2>
                <button type="button" aria-label="关闭新建任务" :disabled="creating" @click="close">✕</button>
            </header>
            <form @submit.prevent="submit">
                <label for="new-task-name">任务标题</label>
                <input id="new-task-name" ref="titleInput" v-model="title" :maxlength="TASK_TITLE_MAX" required
                    :disabled="creating" placeholder="用一句短语概括任务" />
                <label for="new-task-goal">任务目标</label>
                <textarea id="new-task-goal" v-model="goal" rows="4" :maxlength="TASK_GOAL_MAX" required
                    :disabled="creating" placeholder="想完成什么？怎样算完成？"></textarea>
                <p class="field-note">创建后可以在任务里继续发消息、补充或修改要求。</p>

                <label for="new-task-device">执行设备</label>
                <select id="new-task-device" v-model="deviceId" required :disabled="creating || !devices.length">
                    <option disabled value="">{{ devices.length ? '选择执行设备' : '暂无在线设备' }}</option>
                    <option v-for="device in devices" :key="device.id" :value="device.id">
                        {{ device.name || device.host || device.id }} · {{ device.host || device.id }}
                    </option>
                </select>
                <p v-if="selectedDevice?.description" class="field-note">{{ selectedDevice.description }}</p>
                <p v-if="!devices.length" class="form-error">请先让一台电脑连接 Roam。</p>
                <p v-if="client.status && !client.status.model_ready" class="form-error">
                    请先在 <button type="button" class="text-link" @click="settings">设置</button> 中配置模型。
                </p>

                <details>
                    <summary>工作目录与执行上限（可选）</summary>
                    <label for="new-task-workdir">工作目录</label>
                    <input id="new-task-workdir" v-model="workdir" :disabled="creating" placeholder="绝对路径，留空使用默认工作目录" />
                    <div class="budget-fields">
                        <div><label for="new-task-steps">步数上限</label><input id="new-task-steps" v-model="steps" type="number" min="1" step="1" :disabled="creating" placeholder="不限" /></div>
                        <div><label for="new-task-minutes">分钟上限</label><input id="new-task-minutes" v-model="minutes" type="number" min="1" step="any" :disabled="creating" placeholder="不限" /></div>
                        <div><label for="new-task-cost">金额上限</label><input id="new-task-cost" v-model="cost" type="number" min="0.01" step="any" :disabled="creating" placeholder="不限" /></div>
                    </div>
                </details>
                <p class="field-note">任务结束或需要你决定时，助理会主动汇报。</p>
                <p v-if="error" class="form-error" role="alert">{{ error }}</p>
                <footer>
                    <button type="button" class="cancel" :disabled="creating" @click="close">取消</button>
                    <button type="submit" class="create" :disabled="!canCreate">{{ creating ? '正在创建…' : '创建并开始' }}</button>
                </footer>
            </form>
        </section>
    </div>
</template>

<style scoped>
.new-task-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 16px; background: #0009; }
.new-task-panel { width: 100%; max-width: 520px; max-height: calc(100dvh - 32px); overflow-y: auto; border: 1px solid var(--color-line-hi); border-radius: 14px; background: var(--color-bg-elev); box-shadow: 0 24px 80px #0008; }
header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--color-line); }
h2 { font-size: 17px; font-weight: 600; color: var(--color-ink); }
header button { width: 28px; height: 28px; color: var(--color-muted); border-radius: 6px; }
form { padding: 4px 20px 20px; }
label { display: block; margin: 16px 0 7px; font-size: 12px; color: var(--color-muted); }
input, textarea, select { display: block; width: 100%; min-width: 0; border: 1px solid var(--color-line-hi); border-radius: 8px; padding: 10px 12px; background: var(--color-bg); color: var(--color-ink); outline: none; font-size: 14px; }
input:focus, textarea:focus, select:focus { border-color: var(--color-accent); }
textarea { resize: vertical; line-height: 1.6; }
.field-note { margin-top: 7px; font-size: 12px; line-height: 1.6; color: var(--color-faint); }
details { margin: 20px 0; padding: 13px 0; border-top: 1px solid var(--color-line); border-bottom: 1px solid var(--color-line); }
summary { color: var(--color-muted); font-size: 12px; cursor: pointer; }
.budget-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.form-error { margin-top: 10px; color: var(--color-bad); font-size: 12px; line-height: 1.6; }
.text-link { text-decoration: underline; text-underline-offset: 3px; }
footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
footer button { padding: 9px 16px; border-radius: 8px; font-size: 13px; }
.cancel { border: 1px solid var(--color-line-hi); color: var(--color-muted); }
.create { color: var(--color-bg); background: var(--color-accent); }
button:disabled, input:disabled, textarea:disabled, select:disabled { opacity: .45; cursor: not-allowed; }
</style>

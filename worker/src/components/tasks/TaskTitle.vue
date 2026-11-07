<script setup>
import { nextTick, ref, watch } from 'vue';
import { useTasksStore } from '@/stores/tasks';
import { TASK_TITLE_MAX, normalizeTaskTitle } from '../../../shared/tasks.js';

const props = defineProps({ task: { type: Object, required: true } });
const tasks = useTasksStore();
const editing = ref(false), saving = ref(false), value = ref(''), error = ref(''), input = ref(null);
watch(() => props.task.id, () => { editing.value = false; error.value = ''; });
async function edit() {
    value.value = props.task.title || '';
    editing.value = true; error.value = '';
    await nextTick(); input.value?.focus(); input.value?.select();
}
function cancel() { if (!saving.value) { editing.value = false; error.value = ''; } }
async function save() {
    if (saving.value) return;
    error.value = '';
    const id = props.task.id;
    try {
        const title = normalizeTaskTitle(value.value);
        saving.value = true;
        await tasks.rename(props.task, title);
        if (props.task.id === id) editing.value = false;
    } catch (err) { if (props.task.id === id) error.value = err.message || '标题保存失败'; }
    finally { saving.value = false; }
}
</script>

<template>
    <div class="task-title">
        <form v-if="editing" @submit.prevent="save" @keydown.esc.prevent="cancel">
            <input ref="input" v-model="value" aria-label="任务标题" :maxlength="TASK_TITLE_MAX" :disabled="saving" required />
            <button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
            <button type="button" :disabled="saving" @click="cancel">取消</button>
        </form>
        <button v-else type="button" class="title-button" aria-label="修改任务标题" @click="edit">
            <span>{{ task.title || '未命名任务' }}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5L8 21H3v-5z M13 6l5 5" /></svg>
        </button>
        <p v-if="error" class="title-error" role="alert">{{ error }}</p>
    </div>
</template>

<style scoped>
.task-title { position: relative; min-width: 0; }
.title-button { display: flex; align-items: center; gap: 8px; max-width: 100%; text-align: left; font-family: var(--font-serif); font-size: 15px; font-weight: 700; color: var(--color-ink); }
.title-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title-button svg { flex-shrink: 0; color: var(--color-faint); }
.title-button:hover svg { color: var(--color-ink); }
form { display: flex; align-items: center; gap: 8px; }
input { width: min(100%, 480px); min-width: 0; padding: 5px 8px; border: 1px solid var(--color-accent); border-radius: 5px; background: var(--color-bg); color: var(--color-ink); font-size: 14px; outline: none; }
form button { flex-shrink: 0; font-size: 12px; color: var(--color-muted); }
form button[type=submit] { color: var(--color-accent); }
button:disabled, input:disabled { opacity: .5; }
.title-error { position: absolute; top: 100%; left: 0; margin-top: 8px; padding: 6px 10px; border: 1px solid var(--color-line); border-radius: 5px; background: var(--color-bg-elev); font-size: 12px; color: var(--color-bad); }
</style>

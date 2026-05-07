<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useWsStore } from '@/stores/ws';
import { useTerminalStore } from '@/stores/terminal';
import { useSnippetsStore } from '@/stores/snippets';
import TerminalToolbar from '@/components/terminal/TerminalToolbar.vue';
import BottomPanel from '@/components/terminal/BottomPanel.vue';
import InputBar from '@/components/terminal/InputBar.vue';
import SnippetModal from '@/components/terminal/SnippetModal.vue';

const ws = useWsStore();
const term = useTerminalStore();
const snippets = useSnippetsStore();

const inputBarRef = ref(null);
const handleResize = () => term.fitActiveTerminal();

const showModal = ref(false);
const editingId = ref(null);
const initialName = ref('');
const initialCmd = ref('');
const initialAutoSend = ref(true);

function openAdd() {
    editingId.value = null;
    initialName.value = '';
    initialCmd.value = term.inputText || '';
    initialAutoSend.value = false;
    showModal.value = true;
}

function openEdit(s) {
    editingId.value = s.id;
    initialName.value = s.name;
    initialCmd.value = s.command;
    initialAutoSend.value = s.autoSend !== false;
    showModal.value = true;
}

function runSnippet(s) {
    if (s.autoSend) {
        term.sendInputRaw(s.command + '\r');
    } else {
        term.inputText = s.command;
        nextTick(() => inputBarRef.value?.focus());
    }
}

function setTerminalContainer(terminalId, el) {
    if (el) term.mountTerminal(terminalId, el);
}

watch([() => term.showPanel, () => term.activeTab, () => snippets.snippets.length, () => ws.canUseActions], () => {
    setTimeout(term.fitActiveTerminal, 60);
});

watch(() => term.activeTerminalId, () => {
    setTimeout(term.fitActiveTerminal, 30);
});

onMounted(() => {
    term.initialize();
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
});

onUnmounted(() => {
    window.removeEventListener('resize', handleResize);
    window.visualViewport?.removeEventListener('resize', handleResize);
});
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col">
        <TerminalToolbar v-show="ws.showActions" />

        <div class="relative min-h-0 flex-1 bg-black">
            <main
                v-for="tab in term.terminalTabs"
                :key="tab.id"
                v-show="tab.id === term.activeTerminalId"
                :ref="(el) => setTerminalContainer(tab.id, el)"
                class="h-full w-full overflow-hidden bg-black"
            ></main>

            <div v-if="!term.terminalTabs.length" class="flex h-full items-center justify-center text-sm text-zinc-500">
                等待终端列表...
            </div>
        </div>

        <BottomPanel v-show="ws.canUseActions && term.showPanel"
            @openAddSnippet="openAdd"
            @editSnippet="openEdit"
            @runSnippet="runSnippet" />

        <InputBar v-show="ws.canUseActions" ref="inputBarRef" />

        <SnippetModal
            :open="showModal"
            :editingId="editingId"
            :initialName="initialName"
            :initialCmd="initialCmd"
            :initialAutoSend="initialAutoSend"
            @close="showModal = false" />
    </div>
</template>

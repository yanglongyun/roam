<script setup>
import { onMounted } from 'vue';
import { useFilesStore } from '@/stores/files';
import { useWsStore } from '@/stores/ws';
import FilesToolbar from '@/components/files/FilesToolbar.vue';
import FileList from '@/components/files/FileList.vue';
import UploadProgress from '@/components/files/UploadProgress.vue';
import PreviewModal from '@/components/files/PreviewModal.vue';
import ActionSheet from '@/components/files/ActionSheet.vue';

const files = useFilesStore();
const ws = useWsStore();

function onDragOver(e) {
    e.preventDefault();
    files.isDragOver = true;
}
function onDragLeave() { files.isDragOver = false; }
function onDrop(e) {
    e.preventDefault();
    files.isDragOver = false;
    if (!ws.canUseActions) return;
    const list = e.dataTransfer?.files;
    if (list?.length) files.uploadFiles(list);
}

onMounted(() => { files.ensureLoaded(); });
</script>

<template>
    <div class="flex-1 min-h-0 flex flex-col bg-zinc-950 relative"
         @dragover="onDragOver"
         @dragleave="onDragLeave"
         @drop="onDrop">
        <FilesToolbar />
        <FileList />
        <UploadProgress />

        <div v-if="files.isDragOver"
            class="absolute inset-0 pointer-events-none border-2 border-dashed border-emerald-500 bg-emerald-500/10 flex items-center justify-center">
            <div class="text-emerald-300 text-sm font-medium">松手上传到当前目录</div>
        </div>

        <PreviewModal />
        <ActionSheet />
    </div>
</template>

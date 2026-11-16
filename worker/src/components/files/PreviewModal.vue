<script setup>
import { useFilesStore, humanSize } from '@/stores/files';
const files = useFilesStore();
</script>

<template>
    <div v-if="files.preview"
        class="fade-enter fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
        @click.self="files.closePreview">
        <div class="sheet-enter sm:animate-none w-full sm:max-w-3xl h-full sm:h-[85vh] bg-zinc-900 border border-zinc-800 sm:rounded-2xl flex flex-col safe-top safe-bottom">
            <div class="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800">
                <div class="min-w-0">
                    <div class="text-sm text-zinc-100 truncate">{{ files.preview.name }}</div>
                    <div class="text-[11px] text-zinc-500 truncate">{{ files.preview.mime || '未知类型' }} · {{ humanSize(files.preview.size) }}</div>
                </div>
                <div class="shrink-0 flex items-center gap-1">
                    <div v-if="files.preview.kind === 'markdown' || files.preview.kind === 'html'"
                        class="flex rounded border border-zinc-700 overflow-hidden text-xs mr-1">
                        <button @click="files.setPreviewMode('rendered')"
                            :class="['px-3 h-8 transition-colors', files.preview.mode !== 'source' ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200']">
                            预览
                        </button>
                        <button @click="files.setPreviewMode('source')"
                            :class="['px-3 h-8 transition-colors', files.preview.mode === 'source' ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200']">
                            源码
                        </button>
                    </div>
                    <button @click="files.downloadPreview"
                        class="px-3 h-8 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded border border-zinc-700 transition-colors">
                        下载
                    </button>
                    <button @click="files.closePreview"
                        class="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors">
                        ✕
                    </button>
                </div>
            </div>
            <div class="flex-1 min-h-0 overflow-auto">
                <div v-if="files.preview.kind === 'loading'" class="h-full flex items-center justify-center text-zinc-500 text-sm">加载中...</div>
                <div v-else-if="files.preview.kind === 'error'" class="h-full flex items-center justify-center text-red-400 text-sm p-4">{{ files.preview.error }}</div>
                <template v-else-if="files.preview.kind === 'markdown' || files.preview.kind === 'html'">
                    <iframe v-if="files.preview.mode !== 'source'"
                        :srcdoc="files.preview.doc"
                        :sandbox="files.preview.kind === 'html' ? 'allow-scripts allow-popups' : 'allow-popups'"
                        :title="files.preview.name"
                        class="w-full h-full border-0"
                        :class="files.preview.kind === 'html' ? 'bg-white' : 'bg-zinc-900'"></iframe>
                    <pre v-else class="p-4 font-mono text-xs text-zinc-200 whitespace-pre-wrap break-all">{{ files.preview.content }}</pre>
                </template>
                <pre v-else-if="files.preview.kind === 'text'" class="p-4 font-mono text-xs text-zinc-200 whitespace-pre-wrap break-all">{{ files.preview.content }}</pre>
                <div v-else-if="files.preview.kind === 'image'" class="h-full flex items-center justify-center p-4">
                    <img :src="files.preview.url" class="max-w-full max-h-full object-contain" />
                </div>
                <div v-else class="h-full flex flex-col items-center justify-center text-zinc-500 text-sm p-6 gap-3">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <div>无法预览此文件类型</div>
                    <button @click="files.downloadPreview" class="px-4 h-9 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded">下载查看</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useFilesStore } from '@/stores/files';
import { useWsStore } from '@/stores/ws';
import { useToastStore } from '@/stores/toast';
import { useTerminalStore } from '@/stores/terminal';

const files = useFilesStore();
const ws = useWsStore();
const toast = useToastStore();
const term = useTerminalStore();
const router = useRouter();
const route = useRoute();

const fileInputEl = ref(null);
const searchInputEl = ref(null);
const showSearch = ref(false);
const showSortMenu = ref(false);

function triggerUpload() {
    if (!ws.canUseActions) return;
    fileInputEl.value?.click();
}
function onFileSelect(e) {
    const list = e.target.files;
    if (list?.length) files.uploadFiles(list);
    e.target.value = '';
}

async function toggleSearch() {
    showSearch.value = !showSearch.value;
    if (!showSearch.value) {
        files.filterText = '';
    } else {
        await nextTick();
        searchInputEl.value?.focus();
    }
}

function openInTerminal() {
    if (!ws.canUseActions || !files.cwd) return;
    const escaped = files.cwd.replace(/"/g, '\\"');
    ws.sendMsg({
        type: 'data.input',
        to: 'desktop',
        data: { terminalId: term.activeTerminalId, input: `cd "${escaped}"\r` }
    });
    router.push({ path: '/terminal', query: route.query });
    toast.show('已切到终端');
}

const sortOptions = [
    { by: 'name', label: '名称' },
    { by: 'size', label: '大小' },
    { by: 'mtime', label: '修改时间' },
];

function pickSort(by) {
    files.setSort(by);
    showSortMenu.value = false;
}
</script>

<template>
    <div class="shrink-0 border-b border-line bg-bg">
        <!-- Row 1: actions -->
        <div class="flex flex-wrap items-center gap-1 px-3 py-2.5">
            <button @click="toggleSearch" class="tb-btn"
                :class="{ 'is-active': showSearch || files.filterText }" title="搜索">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </button>

            <button @click="files.refresh" class="tb-btn" :disabled="!ws.canUseActions" title="刷新">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
            </button>

            <div class="relative">
                <button @click="showSortMenu = !showSortMenu" class="tb-btn"
                    :class="{ 'is-active': showSortMenu }" title="排序">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M11 18h2"/></svg>
                </button>
                <template v-if="showSortMenu">
                    <div class="fixed inset-0 z-40" @click="showSortMenu = false"></div>
                    <div class="absolute left-0 top-full mt-1 min-w-[140px] rounded-[10px] shadow-2xl z-50 py-1 border border-line bg-bg-elev">
                        <button v-for="opt in sortOptions" :key="opt.by"
                            @click="pickSort(opt.by)"
                            class="w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-bg-hi"
                            :class="files.sortBy === opt.by ? 'text-accent' : 'text-ink'">
                            <span>{{ opt.label }}</span>
                            <span v-if="files.sortBy === opt.by" class="ml-3 text-xs">
                                {{ files.sortDir === 'asc' ? '↑' : '↓' }}
                            </span>
                        </button>
                    </div>
                </template>
            </div>

            <button @click="files.toggleHidden" class="tb-btn"
                :disabled="!ws.canUseActions"
                :class="{ 'is-active': files.showHidden }" title="显示/隐藏 dot 文件">
                <span class="text-[11px] font-mono">.*</span>
            </button>

            <div class="w-px h-5 mx-1 bg-line"></div>

            <button @click="openInTerminal" class="tb-btn" :disabled="!ws.canUseActions" title="在终端 cd 到此目录">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            </button>

            <button @click="triggerUpload" class="tb-btn" :disabled="!ws.canUseActions" title="上传到当前目录">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/></svg>
            </button>

            <button @click="files.createFolder" class="tb-btn" :disabled="!ws.canUseActions" title="新建目录">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            </button>

            <button @click="files.createFile" class="tb-btn" :disabled="!ws.canUseActions" title="新建空文件">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="13" x2="12" y2="19"/><line x1="9" y1="16" x2="15" y2="16"/></svg>
            </button>

            <button @click="files.copyCurrentPath" class="tb-btn" title="复制当前路径">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>

            <input ref="fileInputEl" type="file" multiple class="hidden" @change="onFileSelect" />
        </div>

        <!-- 搜索框 -->
        <div v-if="showSearch" class="flex items-center gap-2 px-3 py-2 border-t border-line">
            <svg width="14" height="14" class="shrink-0 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input ref="searchInputEl"
                v-model="files.filterText"
                placeholder="在当前目录内搜索..."
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                class="flex-1 min-w-0 px-2 h-8 rounded text-xs outline-none border border-line bg-bg-elev text-ink focus:border-accent" />
            <button v-if="files.filterText" @click="files.filterText = ''" class="tb-btn-sm" title="清空">
                ✕
            </button>
        </div>

        <!-- 面包屑 -->
        <div class="flex flex-wrap items-center gap-x-0.5 gap-y-1 px-3 py-2 border-t border-line">
            <button @click="files.goUp" class="tb-btn-sm" :disabled="!ws.canUseActions" title="上一级">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button @click="files.goHome" class="tb-btn-sm" :disabled="!ws.canUseActions" title="主目录">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>
            </button>
            <div class="w-px h-4 mx-1 bg-line"></div>
            <template v-for="(crumb, i) in files.breadcrumbs" :key="i + crumb.path">
                <button @click="files.navigate(crumb.path)"
                    :disabled="!ws.canUseActions"
                    class="px-2 py-0.5 text-xs text-ink hover:bg-bg-hi rounded whitespace-nowrap transition-colors">
                    {{ crumb.label }}
                </button>
                <span v-if="i < files.breadcrumbs.length - 1 && crumb.label !== '/'" class="text-xs text-faint">/</span>
            </template>
        </div>
    </div>
</template>

<style scoped>
.tb-btn {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-elev);
    color: var(--color-ink);
    border: 1px solid var(--color-line);
    border-radius: 10px;
    transition: border-color 0.12s ease, color 0.12s ease;
}
.tb-btn:hover { border-color: var(--color-accent); }
.tb-btn:disabled,
.tb-btn-sm:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}
.tb-btn:disabled:hover,
.tb-btn-sm:disabled:hover {
    border-color: var(--color-line);
}
.tb-btn.is-active {
    color: var(--color-accent);
    border-color: var(--color-accent);
}

.tb-btn-sm {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-muted);
    border-radius: 6px;
    transition: color 0.12s ease, background 0.12s ease;
}
.tb-btn-sm:hover {
    color: var(--color-ink);
    background: var(--color-bg-hi);
}
</style>

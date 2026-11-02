import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useToastStore } from './toast';
import { useWsStore } from './ws';
import { useFsClient } from '@/composables/useFsClient';

export const useFilesStore = defineStore('files', () => {
    const toast = useToastStore();
    const ws = useWsStore();
    const fs = useFsClient();

    const entries = ref([]);
    const cwd = ref('');
    const homePath = ref('');
    const pathSep = ref('/');
    const loading = ref(false);
    const errorMsg = ref('');
    const showHidden = ref(localStorage.getItem('files_showHidden') === '1');
    const uploadProgress = ref(null);
    const isDragOver = ref(false);

    const preview = ref(null);
    const actionSheet = ref(null);

    const filterText = ref('');
    const sortBy = ref(localStorage.getItem('files_sortBy') || 'name');
    const sortDir = ref(localStorage.getItem('files_sortDir') || 'asc');

    const viewEntries = computed(() => {
        const list = entries.value;
        const q = filterText.value.trim().toLowerCase();
        const filtered = q ? list.filter(e => e.name.toLowerCase().includes(q)) : list;
        const sorted = [...filtered].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            let cmp;
            switch (sortBy.value) {
                case 'size': cmp = (a.size || 0) - (b.size || 0); break;
                case 'mtime': cmp = (a.mtime || 0) - (b.mtime || 0); break;
                default: cmp = a.name.localeCompare(b.name);
            }
            return sortDir.value === 'desc' ? -cmp : cmp;
        });
        return sorted;
    });

    function setSort(by) {
        if (sortBy.value === by) {
            sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
        } else {
            sortBy.value = by;
            sortDir.value = 'asc';
        }
        localStorage.setItem('files_sortBy', sortBy.value);
        localStorage.setItem('files_sortDir', sortDir.value);
    }

    const breadcrumbs = computed(() => {
        const v = cwd.value;
        if (!v) return [];
        const parts = v.split('/').filter(Boolean);
        const result = [{ label: '/', path: '/' }];
        let acc = '';
        for (const p of parts) {
            acc += '/' + p;
            result.push({ label: p, path: acc });
        }
        return result;
    });

    function joinPath(dir, name) {
        if (!dir || dir === '/') return '/' + name;
        return dir + '/' + name;
    }

    async function loadHome() {
        try {
            const res = await fs.fsHome();
            homePath.value = res.path;
            pathSep.value = res.sep || '/';
            if (!cwd.value) cwd.value = res.path;
            await refresh();
        } catch (e) {
            errorMsg.value = e.message;
        }
    }

    async function refresh() {
        if (!cwd.value) return;
        loading.value = true;
        errorMsg.value = '';
        try {
            const res = await fs.fsList(cwd.value, showHidden.value);
            entries.value = res.entries || [];
        } catch (e) {
            errorMsg.value = e.message;
            entries.value = [];
        } finally {
            loading.value = false;
        }
    }

    async function navigate(newPath) {
        if (!newPath) return;
        cwd.value = newPath;
        filterText.value = '';
        await refresh();
    }

    function goUp() {
        const v = cwd.value;
        if (!v || v === '/') return;
        const parts = v.split('/').filter(Boolean);
        parts.pop();
        navigate(parts.length ? '/' + parts.join('/') : '/');
    }

    function goHome() {
        if (homePath.value) navigate(homePath.value);
    }

    function toggleHidden() {
        showHidden.value = !showHidden.value;
        localStorage.setItem('files_showHidden', showHidden.value ? '1' : '0');
        refresh();
    }

    function openEntry(entry) {
        if (entry.type === 'dir') {
            navigate(joinPath(cwd.value, entry.name));
        } else {
            openPreview(entry);
        }
    }

    function openActionSheet(entry) { actionSheet.value = entry; }
    function closeActionSheet() { actionSheet.value = null; }

    function inferKind(mime, name) {
        mime = mime || '';
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('text/')) return 'text';
        if (mime === 'application/json' || mime === 'application/xml') return 'text';
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const codeExts = new Set([
            'js','mjs','ts','tsx','jsx','py','rb','go','rs','java','c','cpp','h','hpp',
            'sh','zsh','bash','yml','yaml','toml','ini','conf','md','txt','log','env',
            'html','htm','css','scss','less','vue','svelte','sql','gitignore','dockerfile',
        ]);
        if (codeExts.has(ext)) return 'text';
        return 'other';
    }

    async function openPreview(entry) {
        const p = joinPath(cwd.value, entry.name);
        preview.value = { name: entry.name, size: entry.size, mime: '', kind: 'loading', path: p };
        try {
            const { meta, blob } = await fs.fsRead(p);
            const mime = meta.mime || 'application/octet-stream';
            const kind = inferKind(mime, entry.name);
            if (kind === 'text') {
                const text = await blob.text();
                preview.value = { name: entry.name, size: entry.size, mime, kind, content: text, path: p, blob };
            } else if (kind === 'image') {
                const url = URL.createObjectURL(blob);
                preview.value = { name: entry.name, size: entry.size, mime, kind, url, blob, path: p };
            } else {
                preview.value = { name: entry.name, size: entry.size, mime, kind: 'other', blob, path: p };
            }
        } catch (e) {
            preview.value = { name: entry.name, size: entry.size, mime: '', kind: 'error', error: e.message, path: p };
        }
    }

    function closePreview() {
        if (preview.value?.url) URL.revokeObjectURL(preview.value.url);
        preview.value = null;
    }

    function saveBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function downloadPreview() {
        const p = preview.value;
        if (!p) return;
        let blob = p.blob;
        if (!blob && p.kind === 'text') {
            blob = new Blob([p.content], { type: 'text/plain' });
        }
        if (blob) saveBlob(blob, p.name);
    }

    async function downloadEntry(entry) {
        const p = joinPath(cwd.value, entry.name);
        toast.show('开始下载 ' + entry.name);
        try {
            const { blob } = await fs.fsRead(p);
            saveBlob(blob, entry.name);
            toast.show('已下载');
        } catch (e) {
            toast.show('下载失败: ' + e.message);
        }
    }

    async function deleteEntry(entry) {
        const p = joinPath(cwd.value, entry.name);
        const msg = entry.type === 'dir'
            ? `确定删除目录 "${entry.name}" 及其全部内容？`
            : `确定删除文件 "${entry.name}"？`;
        if (!confirm(msg)) return;
        try {
            await fs.fsDelete(p, entry.type === 'dir');
            toast.show('已删除');
            refresh();
        } catch (e) {
            toast.show('删除失败: ' + e.message);
        }
    }

    async function renameEntry(entry) {
        const newName = prompt('重命名为：', entry.name);
        if (!newName || newName === entry.name) return;
        if (newName.includes('/')) { toast.show('名称不能含 /'); return; }
        try {
            await fs.fsRename(joinPath(cwd.value, entry.name), joinPath(cwd.value, newName));
            toast.show('已重命名');
            refresh();
        } catch (e) {
            toast.show('重命名失败: ' + e.message);
        }
    }

    async function createFolder() {
        const name = prompt('新建目录名');
        if (!name || !name.trim()) return;
        const trimmed = name.trim();
        if (trimmed.includes('/')) { toast.show('名称不能含 /'); return; }
        try {
            await fs.fsMkdir(joinPath(cwd.value, trimmed));
            toast.show('已创建');
            refresh();
        } catch (e) {
            toast.show('创建失败: ' + e.message);
        }
    }

    async function createFile() {
        const name = prompt('新建文件名');
        if (!name || !name.trim()) return;
        const trimmed = name.trim();
        if (trimmed.includes('/')) { toast.show('名称不能含 /'); return; }
        try {
            const file = new File([''], trimmed, { type: 'text/plain' });
            await fs.fsUpload(joinPath(cwd.value, trimmed), file, null, false);
            toast.show('已创建');
            refresh();
        } catch (e) {
            toast.show('创建失败: ' + e.message);
        }
    }

    async function copyCurrentPath() {
        try {
            await navigator.clipboard.writeText(cwd.value);
            toast.show('路径已复制');
        } catch { toast.show('复制失败'); }
    }

    async function uploadFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        for (const file of files) {
            const dest = joinPath(cwd.value, file.name);
            uploadProgress.value = { filename: file.name, loaded: 0, total: file.size };
            try {
                await fs.fsUpload(dest, file, (loaded, total) => {
                    uploadProgress.value = { filename: file.name, loaded, total };
                });
                toast.show(`${file.name} 上传完成`);
            } catch (e) {
                toast.show(`${file.name} 失败: ${e.message}`);
                break;
            }
        }
        uploadProgress.value = null;
        refresh();
    }

    function ensureLoaded() {
        if (!homePath.value) loadHome();
    }

    // 换设备：目录结构是另一台机器的了，清掉重新从它的用户目录开始。
    watch(() => ws.currentDeviceId, () => {
        entries.value = [];
        cwd.value = '';
        homePath.value = '';
        errorMsg.value = '';
        closePreview();
        actionSheet.value = null;
        if (ws.canUseActions) loadHome();
    });
    watch(() => ws.canUseActions, (ready) => {
        if (ready && !homePath.value) loadHome();
    });

    return {
        entries, viewEntries, cwd, homePath, pathSep, loading, errorMsg,
        showHidden, uploadProgress, isDragOver,
        preview, actionSheet, breadcrumbs,
        filterText, sortBy, sortDir, setSort,
        ensureLoaded, refresh, navigate, goUp, goHome, toggleHidden,
        openEntry, openPreview, closePreview, downloadPreview,
        openActionSheet, closeActionSheet,
        downloadEntry, deleteEntry, renameEntry,
        createFolder, createFile, copyCurrentPath, uploadFiles,
    };
});

export function humanSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function relTime(mtime) {
    if (!mtime) return '';
    const diff = Date.now() - mtime;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 30 * 86400000) return `${Math.floor(diff / 86400000)}天前`;
    const d = new Date(mtime);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

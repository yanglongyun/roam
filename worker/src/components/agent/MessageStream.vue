<script setup>
// 消息流 —— 按轮收纳（移植自 agentic）：
//   · 一条用户消息起一轮。轮内的思考 / 工具 / 中间文本是过程，最后那条正文是结果。
//   · 轮完成且有最终文本 → 过程整体收进「已工作 X」折叠条，最终文本站在外面；
//   · 轮还在进行中（或没有最终文本，比如中途停掉）→ 平铺，过程依次展示。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useConversation } from '@/lib/agent/conversation';
import { useToastStore } from '@/stores/toast';
import { buildRows } from '@/lib/agent/thread';
import { dayLabel, renderMd } from '@/lib/agent/format';
import Icon from './Icon.vue';
import AgentImage from './AgentImage.vue';
import TurnEntries from './TurnEntries.vue';
import TurnFold from './TurnFold.vue';

const agent = useConversation();
const toast = useToastStore();
const router = useRouter();

const rows = computed(() => [...buildRows(agent.messages, agent.compactions, agent.busy), ...agent.notes]);

const blocks = computed(() => {
    const output = [];
    let lastDay = '';
    let entries = [];
    let turnStartAt;
    let turnLastAt;
    let turnKey = '__head__';
    const noteAt = (at) => { if (at) turnLastAt = at; };

    // 收掉当前这轮。live = 最后一轮且还在跑。
    const flushTurn = (live) => {
        if (!entries.length) {
            turnStartAt = undefined;
            turnLastAt = undefined;
            return;
        }
        const list = entries;
        entries = [];
        let finalIndex = -1;
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].kind === 'text' && !list[i].row.streaming) {
                finalIndex = i;
                break;
            }
        }
        if (live || finalIndex < 0) {
            output.push({ kind: 'flat', key: `flat:${turnKey}`, items: list });
        } else {
            const final = list[finalIndex];
            const process = list.filter((_, index) => index !== finalIndex);
            if (process.length) {
                const durationMs = turnStartAt && turnLastAt && turnLastAt > turnStartAt ? turnLastAt - turnStartAt : null;
                output.push({ kind: 'turn', key: `turn:${turnKey}`, items: process, durationMs });
            }
            output.push({ kind: 'message', key: final.row.key, row: final.row, final: true });
        }
        turnStartAt = undefined;
        turnLastAt = undefined;
    };

    for (const row of rows.value) {
        const day = dayLabel(row.at);
        if (day && day !== lastDay) {
            flushTurn(false); // 换天先收上一轮，日期条不站在折叠条中间
            output.push({ kind: 'day', key: `day:${row.key}`, label: day });
            lastDay = day;
        }
        if (row.kind === 'user') {
            flushTurn(false);
            turnKey = row.key;
            turnStartAt = row.at;
            output.push({ kind: 'message', key: row.key, row });
            continue;
        }
        if (row.kind === 'tool') {
            entries.push({ kind: 'tool', row });
            noteAt(row.at);
            continue;
        }
        if (row.kind === 'assistant') {
            // 同一行可能既有思考又有正文 —— 思考属于过程，正文属于文本
            if (row.reasoning) entries.push({ kind: 'think', row });
            if (row.content) entries.push({ kind: 'text', row });
            noteAt(row.at);
            continue;
        }
        // 系统注解独立成块，不搅进轮里
        flushTurn(false);
        output.push({ kind: 'message', key: row.key, row });
        if (row.code === 'task_notification') {
            turnKey = row.key;
            turnStartAt = row.at;
            turnLastAt = undefined;
        }
    }
    flushTurn(agent.busy);
    return output;
});

// 最后那条最终文本：复制行常显（其余悬停出现）
const lastFinalKey = computed(() => {
    for (let i = blocks.value.length - 1; i >= 0; i--) {
        const block = blocks.value[i];
        if (block.kind === 'message' && block.final) return block.key;
    }
    return '';
});

const showWorking = computed(() => {
    if (!agent.busy) return false;
    const last = rows.value[rows.value.length - 1];
    // 正文在流式输出，或过程行自己带着扫光 —— 都轮不到等待动画
    if (last && last.kind === 'assistant' && last.streaming && last.content) return false;
    if (last && last.kind === 'tool' && last.status === 'running') return false;
    return true;
});

// 金额都很小（一次调用常常不到一分钱），按 magnitude 取有效位，避免显示成 0.00。
function money(cost) {
    if (!cost || !cost.amount) return '';
    const amount = cost.amount;
    const text = amount >= 1 ? amount.toFixed(2)
        : amount >= 0.01 ? amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
        : amount.toPrecision(2);
    return `${cost.currency === 'USD' ? '$' : ''}${text}${cost.currency === 'USD' ? '' : ' ' + cost.currency}`;
}

async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast.show('已复制');
    } catch {
        toast.show('复制失败');
    }
}

/* ── 滚动：贴着底部时跟着走；用户上滚就不打扰；滚到顶加载更早的消息并保持视口 ── */

const scrollRef = ref(null);
const innerRef = ref(null);
let stick = true;
let paging = false;
let observer = null;

async function loadMore() {
    if (paging || agent.loadingOlder || !agent.hasMore) return;
    const element = scrollRef.value;
    if (!element) return;
    const id = agent.currentId;
    const top = element.getBoundingClientRect().top;
    const anchor = [...innerRef.value.children].find((child) => !child.classList.contains('chip') && child.getBoundingClientRect().bottom > top);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const height = element.scrollHeight;
    paging = true;
    try {
        const loaded = await agent.loadOlder();
        await nextTick();
        if (loaded && id === agent.currentId && scrollRef.value === element) {
            element.scrollTop += anchor?.isConnected ? anchor.getBoundingClientRect().top - anchorTop : element.scrollHeight - height;
        }
    } finally { paging = false; }
}

function onScroll() {
    const element = scrollRef.value;
    if (!element) return;
    stick = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (element.scrollTop < 60 && agent.hasMore && !agent.loadingOlder) {
        void loadMore();
    }
}

onMounted(() => {
    const element = scrollRef.value;
    element.scrollTop = element.scrollHeight;
    observer = new ResizeObserver(() => {
        if (!paging && stick) {
            element.scrollTop = element.scrollHeight;
        }
    });
    observer.observe(innerRef.value);
});
onBeforeUnmount(() => observer?.disconnect());

// 切对话 / 自己发消息：强制回底并重新粘上
watch(() => agent.viewSeq, () => {
    stick = true;
    nextTick(() => {
        const element = scrollRef.value;
        if (element) element.scrollTop = element.scrollHeight;
    });
});

// 自动填屏：首页不满一屏就没有滚动条，onScroll 永不触发 —— 有更早的就继续拉
watch(() => [agent.ready, agent.hasMore, agent.loadingOlder, rows.value.length], () => {
    if (!agent.ready || !agent.hasMore || agent.loadingOlder || !rows.value.length) return;
    nextTick(() => {
        const element = scrollRef.value;
        if (element && element.scrollHeight <= element.clientHeight + 40) void loadMore();
    });
});
</script>

<template>
    <main ref="scrollRef" class="stream" @scroll.passive="onScroll">
        <div ref="innerRef" class="stream-inner">
            <span v-if="agent.loadingOlder" class="chip">加载更早的消息…</span>
            <button v-else-if="agent.hasMore && rows.length" class="chip chip-btn" @click="loadMore">查看更早的消息</button>

            <button v-if="agent.loadError" class="chip chip-bad chip-btn" @click="agent.openThread(agent.currentId, true)">{{ agent.loadError }}，点击重试</button>
            <span v-else-if="!agent.ready && !rows.length" class="chip">正在打开对话…</span>

            <div v-if="agent.ready && !rows.length && agent.currentTask" class="blank">
                <div class="blank-title">{{ agent.currentTask.goal }}</div>
                <div class="blank-sub">任务还没开始写东西。往下发一句话就是给它追加指令。</div>
            </div>
            <div v-else-if="agent.ready && !rows.length && agent.kind === 'assistant'" class="blank">
                <div class="blank-title">有什么交给助理？</div>
                <div class="blank-sub">
                    说清目标，助理会安排任务。执行过程和进度可以在
                    <button class="link" @click="router.push('/tasks')">任务</button> 应用中查看。
                    <template v-if="agent.status && !agent.status.model_ready">
                        <br />先去 <button class="link" @click="router.push('/settings')">设置</button> 里配置模型。
                    </template>
                </div>
            </div>

            <template v-for="block in blocks" :key="block.key">
                <span v-if="block.kind === 'day'" class="day-chip">{{ block.label }}</span>

                <TurnEntries v-else-if="block.kind === 'flat'" :items="block.items" />

                <div v-else-if="block.kind === 'turn'" class="msg agent">
                    <TurnFold :id="block.key" :duration-ms="block.durationMs">
                        <TurnEntries :items="block.items" in-fold />
                    </TurnFold>
                </div>

                <div v-else-if="block.row.kind === 'user'" class="msg mine">
                    <div class="bubble">
                        <div v-if="block.row.images?.length" class="message-files">
                            <AgentImage v-for="(src, index) in block.row.images" :key="index" :src="src" />
                        </div>
                        <span v-if="block.row.content" class="bubble-text">{{ block.row.content }}</span>
                    </div>
                    <div v-if="block.row.sending" class="send-state">发送中…</div>
                    <button v-else-if="block.row.failed" class="send-retry" @click="agent.retrySend(block.row)">发送失败，点击重试</button>
                </div>

                <div v-else-if="block.row.kind === 'assistant'" class="msg agent">
                    <div class="md" v-html="renderMd(block.row.content)"></div>
                    <div class="act-row" :class="{ always: block.key === lastFinalKey && !agent.busy }">
                        <button class="act" title="复制" @click="copy(block.row.content)"><Icon name="copy" :size="14" /></button>
                        <span v-if="block.row.tokens !== undefined" class="act-tokens"
                            :title="`这次模型请求用掉 ${block.row.tokens.toLocaleString()} tokens` + (block.row.cost ? `，花费 ${money(block.row.cost)}${block.row.cost.peak ? '（高峰价）' : '（空闲价）'}` : '')">
                            {{ block.row.tokens.toLocaleString() }} tokens<template v-if="money(block.row.cost)"> · {{ money(block.row.cost) }}</template>
                        </span>
                    </div>
                </div>

                <details v-else-if="block.row.code === 'compacted' && block.row.content" class="compaction">
                    <summary>已压缩早期对话<template v-if="money(block.row.cost)"> · {{ money(block.row.cost) }}</template></summary>
                    <div class="md" v-html="renderMd(block.row.content)"></div>
                </details>

                <button v-else-if="block.row.code === 'task_notification'" class="chip chip-btn"
                    @click="router.push({ name: 'tasks', params: { id: block.row.taskId } })">{{ block.row.content }} →</button>
                <span v-else class="chip" :class="{ 'chip-bad': block.row.code === 'error' }">
                    {{ block.row.code === 'stopped' ? '已停止' : block.row.content }}
                </span>
            </template>

            <div v-if="showWorking" class="msg agent">
                <div class="working"><span class="orbit"></span><span class="working-text sheen">正在工作…</span></div>
            </div>
        </div>
    </main>
</template>

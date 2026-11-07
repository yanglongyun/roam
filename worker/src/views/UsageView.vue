<script setup>
// 用量与费用：库里只存 token 和模型名，金额按单价现算（改价后历史自动重算）。
import { computed, ref, watch } from 'vue';
import { useAgentClientStore } from '@/stores/agent-client';
import { useWsStore } from '@/stores/ws';

const agent = useAgentClientStore();
const ws = useWsStore();

const usage = ref(null);
const loading = ref(false);
const error = ref('');

async function load() {
    if (!ws.authenticated) return;
    loading.value = true;
    error.value = '';
    try {
        usage.value = await agent.usageStats();
    } catch (err) {
        error.value = err.message || '用量加载失败';
    } finally {
        loading.value = false;
    }
}

watch(() => [ws.authenticated, ws.showActions], ([authed]) => { if (authed) load(); }, { immediate: true });

const SYMBOLS = { USD: '$', CNY: '¥', EUR: '€' };
// 金额常常很小（一次调用几分钱），按量级取有效位，不要显示成 0.00。
function amount(bucket) {
    if (!bucket || !bucket.calls) return '—';
    if (!bucket.currency) return '未定价';
    const value = bucket.cost || 0;
    const text = value >= 1 ? value.toFixed(2)
        : value >= 0.01 ? value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
        : value > 0 ? value.toPrecision(2) : '0';
    const symbol = SYMBOLS[bucket.currency];
    return symbol ? `${symbol}${text}` : `${text} ${bucket.currency}`;
}
const tokenText = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0));

// 最近 14 天：柱子高度按最大值归一，最高留一点空隙。
const dayPeak = computed(() => Math.max(0, ...(usage.value?.by_day || []).map((d) => d.cost || 0)));
const dayTokenPeak = computed(() => Math.max(0, ...(usage.value?.by_day || []).map((d) => d.tokens || 0)));

// 单价表：数字是全天同价，{ peak, idle } 是高峰 / 空闲价。
const priceRows = computed(() => {
    const models = usage.value?.pricing?.models || {};
    return Object.entries(models).map(([name, row]) => ({
        name,
        currency: row.currency || usage.value?.pricing?.currency || 'USD',
        input: pair(row.input),
        cached: pair(row.cached_input),
        output: pair(row.output),
    }));
});
function rate(value) {
    return typeof value === 'number' ? String(value) : '—';
}
function pair(value) {
    if (typeof value === 'number') return { both: value };
    if (!value || typeof value !== 'object') return { both: null };
    return { peak: value.peak, idle: value.idle };
}
function money(n) {
    if (n === null || n === undefined) return '—';
    return String(n);
}
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col bg-zinc-950">
        <main class="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <div class="mx-auto w-full max-w-2xl space-y-4">
                <div v-if="!ws.authenticated" class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
                    未连接云端，读不到用量。
                </div>

                <template v-else>
                    <div class="flex items-center justify-between">
                        <p class="text-[12px] text-zinc-500">
                            每次模型调用（含压缩）的 token 都记在云端，金额按当前单价现算。
                        </p>
                        <button @click="load" :disabled="loading"
                            class="shrink-0 h-7 rounded border border-zinc-700 bg-zinc-800 px-2.5 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50">
                            {{ loading ? '刷新中…' : '刷新' }}
                        </button>
                    </div>

                    <p v-if="error" class="text-xs text-rose-300">{{ error }}</p>

                    <template v-else-if="usage">
                        <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                            <div class="grid grid-cols-3 gap-2 text-center">
                                <div v-for="item in [
                                    { label: '今日', b: usage.today },
                                    { label: '本月', b: usage.month },
                                    { label: '合计', b: usage.all },
                                ]" :key="item.label" class="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
                                    <div class="text-[11px] text-zinc-500">{{ item.label }}</div>
                                    <div class="mt-1 font-mono text-base text-zinc-100">{{ amount(item.b) }}</div>
                                    <div class="mt-0.5 font-mono text-[10.5px] text-zinc-500">
                                        {{ item.b.calls }} 次 · {{ tokenText(item.b.tokens) }} tokens
                                    </div>
                                </div>
                            </div>
                            <p v-if="usage.all.mixed?.length" class="field-note">
                                还用了 {{ usage.all.mixed.map((m) => `${m.currency} ${amount({ ...m, calls: 1 })}`).join('、') }}，
                                总额只显示金额最大的那种币（{{ usage.all.currency }}），不换算。
                            </p>
                        </section>

                        <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">近 {{ usage.by_day.length }} 天</h3>
                            <div class="flex h-16 items-end gap-1">
                                <div v-for="day in usage.by_day" :key="day.day" class="group relative flex-1"
                                    :title="`${day.day}：${amount(day)}，${day.calls} 次调用，${tokenText(day.tokens)} tokens`">
                                    <div class="w-full rounded-sm bg-emerald-600/70 transition-colors group-hover:bg-emerald-500"
                                        :class="{ 'bg-zinc-800': !day.calls }"
                                        :style="`height: ${dayPeak ? Math.max(2, (day.cost || 0) / dayPeak * 64)
                                            : (dayTokenPeak ? Math.max(2, (day.tokens || 0) / dayTokenPeak * 64) : 2)}px`"></div>
                                </div>
                            </div>
                            <div class="mt-1 flex justify-between font-mono text-[10px] text-zinc-600">
                                <span>{{ usage.by_day[0]?.day }}</span>
                                <span>{{ usage.by_day.some((d) => d.calls) ? '按每天金额' : '按每天 token' }}</span>
                                <span>{{ usage.by_day[usage.by_day.length - 1]?.day }}</span>
                            </div>
                        </section>

                        <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">按模型</h3>
                            <div v-if="usage.by_model.length" class="space-y-1.5">
                                <div v-for="item in usage.by_model" :key="item.model"
                                    class="flex items-center gap-2 text-[12px]">
                                    <span class="truncate font-mono text-zinc-300">{{ item.model }}</span>
                                    <span v-if="item.unpriced" class="shrink-0 text-[11px] text-amber-400/80">缺单价</span>
                                    <span class="ml-auto shrink-0 font-mono text-zinc-100">{{ amount(item) }}</span>
                                    <span class="w-16 shrink-0 text-right font-mono text-zinc-600">{{ tokenText(item.tokens) }}</span>
                                    <span class="w-10 shrink-0 text-right font-mono text-zinc-600">{{ item.calls }} 次</span>
                                </div>
                            </div>
                            <p v-else class="text-xs text-zinc-500">还没有调用记录。</p>
                            <p v-if="usage.all.unpriced" class="field-note">
                                有 {{ usage.all.unpriced }} 次调用找不到单价，只统计 token 不计金额。
                            </p>
                        </section>

                        <section class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">单价（每百万 tokens）</h3>
                            <div class="overflow-x-auto">
                                <table class="w-full text-[11.5px]">
                                    <thead class="text-zinc-500">
                                        <tr class="text-left">
                                            <th class="pb-1.5 pr-2 font-medium">模型</th>
                                            <th class="pb-1.5 pr-2 text-right font-medium">输入</th>
                                            <th class="pb-1.5 pr-2 text-right font-medium">缓存输入</th>
                                            <th class="pb-1.5 text-right font-medium">输出</th>
                                        </tr>
                                    </thead>
                                    <tbody class="font-mono text-zinc-300">
                                        <tr v-for="row in priceRows" :key="row.name" class="border-t border-zinc-800/70">
                                            <td class="py-1.5 pr-2 font-sans text-zinc-200">{{ row.name }}</td>
                                            <td v-for="(cell, key) in { input: row.input, cached: row.cached, output: row.output }"
                                                :key="key" class="py-1.5 pr-2 text-right last:pr-0">
                                                <template v-if="cell.both !== undefined">
                                                    {{ money(cell.both) }}
                                                </template>
                                                <template v-else>
                                                    <span class="text-zinc-100">{{ rate(cell.peak) }}</span>
                                                    <span class="text-zinc-600"> / {{ rate(cell.idle) }}</span>
                                                </template>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <p class="field-note">
                                单位 {{ usage.pricing?.currency || 'USD' }}，高峰 / 空闲两档。空闲价是高峰价的一半；高峰为北京时间工作日 9-12 点、14-18 点，法定节假日没有数据，会按高峰算（金额只高估不低估）。单价表在
                                <code class="font-mono">server/agent/pricing.js</code>，也可以在 <code class="font-mono">config.put</code> 里传 <code class="font-mono">pricing.models</code> 覆盖。
                            </p>
                        </section>
                    </template>

                    <p v-else class="text-xs text-zinc-500">{{ loading ? '统计中…' : '暂无用量' }}</p>
                </template>
            </div>
        </main>
    </div>
</template>

<style scoped>
.field-note {
    display: block;
    margin-top: 8px;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--color-faint);
}
</style>

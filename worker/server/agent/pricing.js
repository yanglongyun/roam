// 计费：单价表 + 按调用时间算成本。
//
// 单价单位是「货币 / 百万 tokens」。DeepSeek 的价格分时段：空闲时段是高峰时段的一半，
// 高峰为北京时间周一至周五 9:00-12:00、14:00-18:00（中国法定节假日全天是空闲价，
// 这里没有节假日数据，节假日会按高峰算，偏保守）。
//
// 一条单价可以是数字（全天同价），也可以是 { peak, idle }。
// 各模型自带 currency，不同币种不混算（汇总时按金额最大的币种给总额）。

const HOUR = 3600_000;
const BEIJING_OFFSET = 8 * HOUR;

export const DEFAULT_CURRENCY = 'USD';

// 价格来自 DeepSeek 官方价格页（2026-11），单位美元 / 百万 tokens。
// 改价后在设置里存一份 pricing 覆盖即可，历史用量会按新单价重算 —— 库里只存 token，不存金额。
export function defaultPricing() {
  return {
    currency: DEFAULT_CURRENCY,
    models: {
      'deepseek-flash': {
        currency: 'USD',
        input: { peak: 0.3, idle: 0.15 },
        cached_input: { peak: 0.006, idle: 0.003 },
        output: { peak: 1.2, idle: 0.6 },
      },
      'deepseek-v4-pro': {
        currency: 'USD',
        input: { peak: 1.32, idle: 0.66 },
        cached_input: { peak: 0.044, idle: 0.022 },
        output: { peak: 3.96, idle: 1.98 },
      },
      // 只作参考：OpenAI 公开价，全天同价。
      'gpt-4o-mini': {
        currency: 'USD',
        input: 0.15,
        cached_input: 0.075,
        output: 0.6,
      },
    },
  };
}

/**
 * 高峰时段：官方按 UTC 周一至周五 01:00-04:00、06:00-10:00 收高峰价，
 * 换成北京时间就是 9-12 点、14-18 点；周末和中国法定节假日全天是空闲价。
 * 这里没有节假日数据，节假日会按高峰算，偏保守（金额只会高估不会低估）。
 */
export function isPeak(at = Date.now()) {
  const date = new Date(at + BEIJING_OFFSET);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const hour = date.getUTCHours();
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

const rateAt = (value, peak) => {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return 0;
  return Number(peak ? value.peak : value.idle) || 0;
};

/** 按模型名找单价，大小写不敏感。 */
export function ratesFor(pricing, model) {
  const models = pricing && typeof pricing.models === 'object' ? pricing.models : {};
  const key = String(model || '').trim();
  if (!key) return null;
  if (models[key]) return models[key];
  const lower = key.toLowerCase();
  const hit = Object.keys(models).find((name) => name.toLowerCase() === lower);
  return hit ? models[hit] : null;
}

/**
 * 一次模型调用的 token 明细：缓存命中的输入已经算在 input_tokens 里，
 * 推理 token 已经算在 output_tokens 里，都不要重复加。
 */
export function tokensOf(usage) {
  const input = Number(usage && usage.input_tokens) || 0;
  const cached = Math.min(Number(usage && usage.input_tokens_details && usage.input_tokens_details.cached_tokens) || 0, input);
  const output = Number(usage && usage.output_tokens) || 0;
  return { input, cached, output, total: input + output };
}

/**
 * 一次调用的费用。usage.model 优先，没有就用 fallbackModel（老数据没记模型）。
 * 找不到单价时返回 null —— 前端就只显示 token 不显示钱。
 */
export function costOf(usage, pricing, at = Date.now(), fallbackModel = '') {
  if (!usage) return null;
  const rates = ratesFor(pricing, usage.model || fallbackModel);
  if (!rates) return null;
  const tokens = tokensOf(usage);
  if (!tokens.total) return null;
  const peak = isPeak(at);
  const amount =
    ((tokens.input - tokens.cached) * rateAt(rates.input, peak) +
      tokens.cached * rateAt(rates.cached_input, peak) +
      tokens.output * rateAt(rates.output, peak)) /
    1_000_000;
  return {
    amount,
    currency: rates.currency || (pricing && pricing.currency) || DEFAULT_CURRENCY,
    peak,
    tokens: tokens.total,
  };
}

/* ───────────────────────── 汇总 ───────────────────────── */

const emptyBucket = () => ({ costs: new Map(), tokens: 0, calls: 0, unpriced: 0 });

function addTo(bucket, cost, tokens) {
  bucket.calls += 1;
  bucket.tokens += tokens;
  if (!cost) {
    bucket.unpriced += 1;
    return;
  }
  bucket.costs.set(cost.currency, (bucket.costs.get(cost.currency) || 0) + cost.amount);
}

// 同一次用量可能混了币种，按金额最大的币种给一个数，其余挂在 mixed 里。
function finish(bucket) {
  const list = [...bucket.costs.entries()].sort((a, b) => b[1] - a[1]);
  return {
    cost: list.length ? list[0][1] : 0,
    currency: list.length ? list[0][0] : null,
    mixed: list.slice(1).map(([currency, cost]) => ({ currency, cost })),
    tokens: bucket.tokens,
    calls: bucket.calls,
    unpriced: bucket.unpriced,
  };
}

/**
 * 把 usage 行汇总成 今日 / 本月 / 合计 + 按模型 + 按天。
 * rows: [{ usage, created_at }]；tz_offset 是前端时区（分钟，东八区 480）。
 */
export function summarize(pricing, rows, { now = Date.now(), tzOffset = 480, days = 14, fallbackModel = '' } = {}) {
  const shift = tzOffset * 60_000;
  const dayOf = (at) => new Date(at + shift).toISOString().slice(0, 10);
  const today = dayOf(now);
  const month = today.slice(0, 7);

  const all = emptyBucket();
  const todayBucket = emptyBucket();
  const monthBucket = emptyBucket();
  const byModel = new Map();
  const byDay = new Map();

  for (const row of rows) {
    const usage = row.usage;
    const at = row.created_at || now;
    const cost = costOf(usage, pricing, at, fallbackModel);
    const tokens = tokensOf(usage).total;
    const model = usage.model || fallbackModel || '未知模型';
    const day = dayOf(at);

    addTo(all, cost, tokens);
    if (day === today) addTo(todayBucket, cost, tokens);
    if (day.startsWith(month)) addTo(monthBucket, cost, tokens);

    if (!byModel.has(model)) byModel.set(model, emptyBucket());
    addTo(byModel.get(model), cost, tokens);
    if (!byDay.has(day)) byDay.set(day, emptyBucket());
    addTo(byDay.get(day), cost, tokens);
  }

  // 最近 N 天：缺的天补 0，图上不会有空洞。
  const series = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = dayOf(now - index * 86_400_000);
    series.push({ day, ...finish(byDay.get(day) || emptyBucket()) });
  }

  return {
    today: finish(todayBucket),
    month: finish(monthBucket),
    all: finish(all),
    by_model: [...byModel.entries()]
      .map(([model, bucket]) => ({ model, ...finish(bucket) }))
      .sort((a, b) => b.calls - a.calls),
    by_day: series,
  };
}

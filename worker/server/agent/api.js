// 云端业务层：会话、消息、配置、设备、图片。
// ctx 由 DO 提供：env / 配置缓存 / runs（内存）+ 设备快照与设备通道。
import { renderPrompt, requireModel } from './config.js';
import { run } from './loop.js';
import { createRunner, pickTarget } from './runner.js';
import { message } from './ai.js';
import { costOf, summarize } from './pricing.js';
import { describeAvailability, listTools } from './tools.js';
import * as store from './store.js';
import * as tasksStore from './tasks.js';
import * as notifications from './notifications.js';
import { runSql } from './sql.js';
import { deleteImages, imagesEnabled, nameOf, readImage, saveImage } from './images.js';
import { toBase64 } from './crypto.js';

const { fail, pick } = store;

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name || '',
    description: device.description || '',
    platform: device.platform || '',
    arch: device.arch || '',
    host: device.host || '',
    username: device.username || '',
    workdir: device.workdir || '',
    browser: Boolean(device.browser),
    online: Boolean(device.online),
    last_seen: device.last_seen ?? null,
  };
}

/* ───────────────────────── 计费 ───────────────────────── */

// 库里只存 token（还带当时的模型名），金额每次按当前单价现算：
// 改价、补上以前没有的模型单价，历史金额跟着更新，也不会因为算错而脏数据。
function withCost(config, rows) {
  return rows.map((row) => {
    if (!row.usage) return row;
    let usage = row.usage;
    if (typeof usage === 'string') {
      try {
        usage = JSON.parse(usage);
      } catch {
        return { ...row, usage: null };
      }
    }
    const cost = costOf(usage, config.pricing, row.created_at, config.model);
    return cost ? { ...row, usage, cost } : { ...row, usage };
  });
}

// 用量与费用：今日 / 本月 / 合计 + 按模型 + 按天。
async function usageStats(ctx, args) {
  const { tz_offset: tzOffset = 480 } = pick(args, ['tz_offset']);
  if (!Number.isSafeInteger(tzOffset) || tzOffset < -720 || tzOffset > 840) {
    fail(400, '时区偏移无效');
  }
  const config = await ctx.config();
  const rows = await store.usageRows(ctx.env);
  return {
    pricing: config.pricing,
    ...summarize(config.pricing, rows, {
      tzOffset,
      fallbackModel: config.model,
    }),
  };
}

/* ───────────────────────── 状态 ───────────────────────── */

export async function status(ctx) {
  const config = await ctx.config();
  const devices = (await ctx.devices()).map(publicDevice);
  return {
    model: config.model,
    model_ready: Boolean(config.responsesUrl && config.apiKey && config.model),
    workdir: config.workdir || '',
    device_online: devices.some((device) => device.online),
    images: imagesEnabled(ctx.env),
    devices,
  };
}

/* ───────────────────────── 设备 ───────────────────────── */

async function devicesList(ctx, args) {
  pick(args, []);
  return { devices: (await ctx.devices()).map(publicDevice) };
}

async function devicesPatch(ctx, args) {
  const updated = await store.patchDevice(ctx.env, args);
  ctx.waitUntil(ctx.broadcastDevices());
  return publicDevice({ ...updated, online: ctx.onlineDevices().has(updated.id) });
}

async function devicesRemove(ctx, args) {
  const { id } = pick(args, ['id']);
  if (ctx.onlineDevices().has(id)) fail(409, '设备在线，不能删除登记');
  const result = await store.removeDevice(ctx.env, { id });
  ctx.waitUntil(ctx.broadcastDevices());
  return result;
}

/* ───────────────────────── 会话 ───────────────────────── */

async function sessionsList(ctx, args) {
  return store.listSessions(ctx.env, args, ctx.runningIds());
}

// 旧入口只给明确的迁移提示，不再创建可直接执行工具的普通对话。
async function sessionsCreate() {
  fail(410, '独立对话已移除，请在任务应用中新建任务');
}

async function sessionsOpen(ctx, args) {
  const { id } = pick(args, ['id']);
  const config = await ctx.config();
    // 游标与流式快照在查询前一起捕获。客户端在 HTTP 查询期间缓存 WS 事件，
    // 查询返回后只重放此游标之后的事件，完成消息仍按数据库 id 去重。
    const eventCursor = ctx.eventCursor();
    const state = ctx.runs.get(id);
    const snapshot = state && !state.ended ? { text: state.text, reasoning: state.reasoning } : null;
    const opened = await store.openSession(ctx.env, args, snapshot);
  return {
    ...opened,
        event_cursor: eventCursor,
    messages: withCost(config, opened.messages),
    compactions: withCost(config, opened.compactions),
  };
}

async function messagesList(ctx, args) {
  const { id } = pick(args, ['id', 'limit', 'before']);
  const config = await ctx.config();
  const page = await store.listMessages(ctx.env, args);
  return { ...page, messages: withCost(config, page.messages) };
}

async function sessionsPatch(ctx, args) {
  if (await tasksStore.getTask(ctx.env, args.id)) fail(400, '请在任务中修改标题');
  return store.patchSession(ctx.env, args, ctx.runningIds());
}

async function sessionsPins(ctx, args) {
  return store.reorderPins(ctx.env, args);
}

async function sessionsRemove(ctx, args) {
  const result = await store.removeSession(ctx.env, args, ctx.runningIds());
  await deleteImages(ctx.env, result.images);
  return { deleted: result.deleted };
}

/* ───────────────────────── 配置 ───────────────────────── */

async function configGet(ctx) {
  return store.publicConfig(await ctx.config());
}

export async function configPut(ctx, args) {
  const patch = pick(args, [
    'responsesUrl', 'apiKey', 'model', 'context_window', 'router_system', 'task_system', 'compact_at', 'keep',
    'compact_system', 'compact_prefix', 'workdir', 'run_timeout', 'timeout', 'max_output',
    'pricing',
  ]);
  const next = { ...(await ctx.config()) };
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'responsesUrl':
      case 'apiKey':
      case 'model':
      case 'workdir': {
        if (typeof value !== 'string') {
          fail(400, `${key} 必须是字符串`);
        }
        // 设置页不回显密钥，留空表示保留已保存的密钥。
        if (key === 'apiKey' && value.trim() === '') break;
        next[key] = value.trim();
        break;
      }
      default:
        next[key] = value;
    }
  }
  try {
    await store.saveConfig(ctx.env, next);
  } catch (error) {
    fail(400, error.message);
  }
  ctx.invalidateConfig();
  await notifications.resetRetries(ctx.env);
  ctx.waitUntil(flushTaskNotifications(ctx));
  return { saved: true };
}

/* ───────────────────────── 消息 ───────────────────────── */

function parseArgs(raw) {
  if (!raw) return {};
  const args = JSON.parse(raw);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象');
  return args;
}

function deviceLabel(id, devices) {
  const device = devices.find((item) => item.id === id);
  return device ? `${device.name || device.host || id}（id: ${id}）` : id || '未指定';
}

// 发一条消息，开始一轮回复。用户消息存库后立即返回，回复过程通过事件推送。
async function messagesSend(ctx, args) {
  const { id, text, images = [] } = pick(args, ['id', 'text', 'images']);
  if (!Array.isArray(images) || images.length > 5) {
    fail(400, '每条消息最多发送 5 张图片');
  }
  const bytes = new TextEncoder().encode(typeof text === 'string' ? text : '').length;
  if (typeof text !== 'string' || bytes > 128 * 1024 || (!text.trim() && images.length === 0)) {
    fail(400, '请输入文字或选择图片，文字最多 128 KiB');
  }
  if (images.length && !imagesEnabled(ctx.env)) {
    fail(400, '没有绑定 R2，不能发送图片');
  }
  const names = [];
  for (const image of images) {
    const name = typeof image === 'string' ? nameOf(image) : null;
    if (!name) {
      fail(400, '图片地址无效，请重新上传');
    }
    names.push(name);
  }
  const config = await ctx.config();
  try {
    requireModel(config);
  } catch (error) {
    fail(400, error.message);
  }
  await store.requireSession(ctx.env, id);

  // 任务会话：这句话是给这个任务的新指令，直接追加并让它带着新指令重新跑。
  const task = await tasksStore.getTask(ctx.env, id);
  if (task) {
    if (images.length) fail(400, '任务会话里只能发文字指令');
    return steerTask(ctx, task, text);
  }
  if (id !== tasksStore.ROUTER_ID) fail(410, '独立对话已移除，请在任务应用中新建任务');

  // 检查和登记之间没有 await 以外的空隙：DO 单线程，同一会话不会同时开始两轮。
  if (ctx.runs.has(id)) {
    fail(409, '会话正在回复');
  }
  const state = {
    controller: new AbortController(),
    done: null,
    text: '',
    reasoning: '',
    runImages: new Set(),
    kind: 'router',
  };
  ctx.runs.set(id, state);
  ctx.markRunning(id);

  try {
    const user = message(text);
    if (!text.trim()) {
      user.content = [];
    }
    for (const image of images) {
      user.content.push({ type: 'input_image', image_url: image, detail: 'auto' });
    }
    const saved = await store.saveMessage(ctx.env, id, user);
    ctx.publish(id, { type: 'message', item: user, ...saved });
    state.done = reply(ctx, id, state).then(async (result) => {
      if (id === tasksStore.ROUTER_ID && result?.status === 'completed') {
        await notifications.acknowledgeThrough(ctx.env, saved.id);
      }
      return result;
    }).finally(() => {
      ctx.runs.delete(id);
      ctx.markIdle(id);
      if (id === tasksStore.ROUTER_ID) ctx.waitUntil(flushTaskNotifications(ctx));
    });
    ctx.waitUntil(state.done);
    return saved;
  } catch (error) {
    ctx.runs.delete(id);
    ctx.markIdle(id);
    throw error;
  }
}

// 停止这个会话正在运行的回复，等它真正结束（done 已推送）再返回。
async function messagesStop(ctx, args) {
  const { id } = pick(args, ['id']);
  const current = ctx.runs.get(id);
  if (current) {
    current.controller.abort(new DOMException('已停止', 'AbortError'));
    await current.done.catch(() => {});
  }
  return { stopped: Boolean(current) };
}

/* ───────────────────────── 一轮回复 ───────────────────────── */

// kind：router（助理）/ task（任务执行者，绑定设备）。
async function reply(ctx, id, state, options = {}) {
  const env = ctx.env;
  const kind = options.kind || state.kind;
  if (!['router', 'task'].includes(kind)) throw new Error('无效的执行角色');
  const task = options.task || null;
  const push = (event) => {
    if (event.type === 'done') state.ended = true;
    ctx.publish(id, options.notification ? { ...event, trigger: 'task_notification' } : event);
  };
  const devices = (await ctx.devices()).map(publicDevice);
  // 每轮快照补全背景；任务结果还会持久化入队，主动唤醒助理处理。
  const tasks = kind === 'router' ? await taskSnapshot(env) : [];
  const scope = { devices, tasks };
  const config = {
    ...(await ctx.config()),
    images_dir: 'r2',
    run_images: state.runImages,
    session_id: id,
    session_title: await store.sessionTitle(env, id),
  };
  const availability = describeAvailability({ devices, images: imagesEnabled(env) });

  let instructions;
  if (kind === 'router') {
    // 提示词主体按优先级取：当前会话的 sessions.system_prompt（非空）> settings.system_prompt（非空）
    // > 内置 router_system。会话那层每轮现读，改了下一轮就生效。
    const sessionPrompt = await store.sessionSystemPrompt(env, id);
    const systemPrompt = String(sessionPrompt).trim()
      ? sessionPrompt
      : String(config.system_prompt || '').trim()
        ? config.system_prompt
        : config.router_system;
    instructions = renderPrompt(systemPrompt.replace('{{device_status}}', availability), scope) + notifications.ROUTER_NOTIFICATION_INSTRUCTION;
  } else {
    instructions = renderPrompt(config.task_system, {
      ...scope,
      goal: task.goal || '',
      device: deviceLabel(task.device_id, devices),
      workdir: task.workdir || '（设置里配置的工作目录）',
    });
  }
  if (options.notification) instructions += notifications.AUTO_REPORT_INSTRUCTION;

  const boundDeviceId = kind === 'task' ? task.device_id || '' : '';
  const deviceRunner = createRunner({
    env,
    bridge: ctx.bridge,
    sendToDevice: ctx.sendToDevice,
    sessionId: id,
    boundDeviceId,
    workdir: kind === 'task' ? task.workdir || '' : '',
    // 登记信息用回复开始时的快照，在线状态每次工具调用时现查。
    devices: () => {
      const online = ctx.onlineDevices();
      return devices.map((device) => ({ ...device, online: online.has(device.id) }));
    },
  });
  const runTool = kind === 'router' ? createRouterRunner(ctx) : withReport(ctx, task, deviceRunner, state);

  const budget = kind === 'task' ? task.budget || null : null;

  // 超时：AbortController + DO alarm（见 DO 的 alarm 处理）。
  const timer = setTimeout(
    () => state.controller.abort(new DOMException('回复超时', 'TimeoutError')),
    config.run_timeout * 1000,
  );
  try {
    const usage = await store.lastUsage(env, id);
    const { latest, stored } = await store.contextMessages(env, id);
    const messages = stored.map((row) => JSON.parse(row.item));
    // 与 messages 位置一一对应，压缩时把数组下标换算成数据库 ID。
    const messageIds = stored.map((row) => row.id);
    if (latest) {
      messages.unshift(message(latest.summary));
      messageIds.unshift(latest.message_id);
    }
    // 已存但还没有结果的工具调用；本次模型响应最后存入的一条，usage 附在它上面。
    const openCalls = new Set();
    let lastId = 0;

    const save = async (item) => {
      const saved = await store.saveMessage(env, id, item);
      messageIds.push(saved.id);
      lastId = saved.id;
      return saved;
    };

    state.result = await run({
      env,
      instructions,
      messages,
      model: config.model,
      config,
      scope,
      tools: listTools({ mode: kind, computer: imagesEnabled(env) && devices.some((device) => device.id === boundDeviceId && device.platform === 'darwin') }),
      runTool,
      usage,
      signal: state.controller.signal,
      onEvent: async (event) => {
        switch (event.type) {
          case 'message':
          case 'reasoning':
          case 'function_call':
          case 'function_call_output': {
            if (!event.item) {
              state[event.type === 'message' ? 'text' : 'reasoning'] += event.delta;
              push(event);
              return;
            }
            const saved = await save(event.item);
            if (event.type === 'message') {
              state.text = '';
            } else if (event.type === 'reasoning') {
              state.reasoning = '';
            } else if (event.type === 'function_call') {
              openCalls.add(event.item.call_id);
            } else {
              openCalls.delete(event.item.call_id);
              // 工具图片已被存下的结果引用，不再属于待清理图片。
              if (Array.isArray(event.item.output)) {
                for (const part of event.item.output) {
                  state.runImages.delete(part.image_url);
                }
              }
            }
            push({ ...event, ...saved });
            return;
          }
          case 'usage': {
            if (lastId && event.usage) {
              await store.setMessageUsage(env, lastId, event.usage);
            }
            // 实时也算一份金额，前端不用自己维护单价表。
            const cost = event.usage
              ? costOf(event.usage, config.pricing, Date.now(), config.model)
              : null;
            // 任务的步数和花费按 SQL 自增记到控制面，Router 下一轮就能看到。
            if (kind === 'task' && event.usage) {
              await tasksStore.addUsage(env, id, { steps: 1, cost: cost?.amount || 0 });
              const fresh = await tasksStore.getTask(env, id);
              const over = budgetExceeded(fresh || task, budget);
              if (over && !state.budget) {
                state.budget = over;
                state.controller.abort(new DOMException(over, 'AbortError'));
              }
            }
            push({ ...event, cost, message_id: lastId });
            return;
          }
          case 'compact': {
            if (event.status !== 'completed') {
              push(event);
              return;
            }
            const messageId = messageIds[event.end - 1];
            if (event.start !== 0 || !messageId) {
              throw new Error('压缩边界无效');
            }
            const compaction = await store.addCompaction(
              env,
              id,
              messageId,
              event.item.content[0].text,
              event.usage || null,
            );
            messageIds.splice(event.start, event.end - event.start, messageId);
            push({
              type: 'compact',
              status: 'completed',
              id: compaction.id,
              message_id: compaction.message_id,
              summary: compaction.summary,
              created_at: compaction.created_at,
            });
            return;
          }
          case 'done': {
            // 停止或失败时，给还没有结果的工具调用补一条，保证下次请求模型时调用和结果成对。
            try {
              for (const callId of openCalls) {
                const item = {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({ success: false, text: '已停止' }),
                };
                push({ type: 'function_call_output', item, ...(await save(item)) });
              }
            } catch (error) {
              console.error('补写工具结果失败：', error.message);
            }
            push(event);
            return;
          }
          default:
            push(event);
        }
      },
    });
  } catch (error) {
    // Agent 在 run 内部收尾；走到这里说明准备上下文就失败了，补发 error 和 done。
    push({ type: 'error', code: 'api_error', error: error.message });
    push({ type: 'done', status: 'incomplete', stopReason: 'api_error' });
    state.result = { status: 'incomplete', stopReason: 'api_error', error: error.message, text: '' };
  } finally {
    clearTimeout(timer);
    // 没被任何消息引用的工具图片直接删掉，别在 R2 里堆垃圾。
    await deleteImages(env, [...state.runImages].map(nameOf).filter(Boolean));
  }
  return state.result;
}

/* ───────────────────────── 任务 ───────────────────────── */
// 一个任务 = 一个独立会话 + 一台设备 + 一段目标。它跑在自己的循环里，跟人的对话互不占场。

function requireTaskExists(task) {
  if (!task) fail(404, '任务不存在');
  return task;
}

function budgetExceeded(task, budget) {
  if (!budget) return '';
  if (budget.steps && task.steps >= budget.steps) return `超出步数上限（${budget.steps} 步）`;
  if (budget.cost && task.cost >= budget.cost) return `超出金额上限（$${budget.cost}）`;
  if (budget.minutes) {
    const started = task.created_at || Date.now();
    if (Date.now() - started >= budget.minutes * 60000) return `超出时间上限（${budget.minutes} 分钟）`;
  }
  return '';
}

// 助理看到的任务快照，按注入顺序分三组：
// 1) 全部置顶任务（不限条数、不限状态，永远在最前，不会被挤掉）；
// 2) 其余需要关注的状态（排队 / 运行 / 等人 / 失败 / 中断）；
// 3) 最近结束的几条（含 done / cancelled），按更新时间取。
async function taskSnapshot(env) {
  const pinned = await tasksStore.listPinnedTasks(env);
  const rows = await tasksStore.listTasks(env, { pinned: false, limit: 40 });
  const attention = rows.filter((task) => tasksStore.ATTENTION_STATES.includes(task.status));
  const recent = rows.filter((task) => !tasksStore.ATTENTION_STATES.includes(task.status)).slice(0, 5);
  return [...pinned, ...attention, ...recent];
}

// 任务执行者比会话多一个 report：把进度写到控制面，让助理和人都能看见。
function withReport(ctx, task, base, state) {
  return async (call, context) => {
    if (call.name !== 'report') {
      return base(call, context);
    }
    let args = {};
    try {
      args = parseArgs(call.arguments);
    } catch {
      return { text: '参数无效，report 需要 {progress, needs_human}', failed: true };
    }
    const progress = typeof args.progress === 'string' ? args.progress.trim().slice(0, 120) : '';
    const needsHuman = Boolean(args.needs_human);
    const patch = {};
    if (progress) patch.progress = progress;
    if (needsHuman) patch.status = 'needs_human';
    if (Object.keys(patch).length) await tasksStore.patchTask(ctx.env, task.id, patch, needsHuman ? {
      id: state.notificationId, result: progress || '需要人工决定',
    } : null);
    if (needsHuman) ctx.waitUntil(flushTaskNotifications(ctx));
    return {
      stop: needsHuman,
      stopReason: needsHuman ? 'needs_human' : undefined,
      text: needsHuman
        ? '已把进度记下，并标记为等待人工决定。现在收尾，别继续做需要人拍板的部分。'
        : '已记录进度。',
    };
  };
}

// 助理的工具：派活、看任务、改指令、取消、查库。
function createRouterRunner(ctx) {
  return async (call) => {
    let args;
    try {
      args = parseArgs(call.arguments);
    } catch (error) {
      return { text: `参数无效：${error.message}`, failed: true };
    }
    try {
      switch (call.name) {
        case 'dispatch_task':
          return { text: JSON.stringify(await dispatchTask(ctx, args)) };
        case 'tasks':
          return { text: JSON.stringify(await tasksList(ctx, args)) };
        case 'steer_task': {
          const task = requireTaskExists(await tasksStore.getTask(ctx.env, args.id));
          return { text: JSON.stringify(await steerTask(ctx, task, args.text)) };
        }
        case 'cancel_task': {
          const task = requireTaskExists(await tasksStore.getTask(ctx.env, args.id));
          return { text: JSON.stringify(await cancelTask(ctx, task)) };
        }
        case 'pin_task': {
          const { id, pinned } = pick(args, ['id', 'pinned']);
          requireTaskExists(await tasksStore.getTask(ctx.env, id));
          return { text: JSON.stringify({ task: await tasksStore.pinTask(ctx.env, id, pinned) }) };
        }
        case 'rename_task': {
          const { id, title } = pick(args, ['id', 'title']);
          return { text: JSON.stringify({ task: await tasksStore.renameTask(ctx.env, id, title) }) };
        }
        case 'delete_task': {
          const { id, withMessages = false } = pick(args, ['id', 'withMessages']);
          requireTaskExists(await tasksStore.getTask(ctx.env, id));
          if (ctx.runningIds().has(id)) fail(409, '任务正在运行，请先取消再删');
          return { text: JSON.stringify(await tasksStore.deleteTask(ctx.env, id, { withMessages: Boolean(withMessages) })) };
        }
        case 'sql': {
          return { text: JSON.stringify(await runSql(ctx.env.DB, args)) };
        }
        default:
          return { text: `没有这个工具：${call.name}`, failed: true };
      }
    } catch (error) {
      return { text: error.message, failed: true };
    }
  };
}

async function dispatchTask(ctx, args) {
  const { title, goal, device: requested = '', workdir = '', budget } = pick(args, [
    'title',
    'goal',
    'device',
    'workdir',
    'budget',
  ]);
  try {
    requireModel(await ctx.config());
  } catch (error) {
    fail(400, error.message);
  }
  const devices = (await ctx.devices()).map(publicDevice);
  let target;
  try { target = pickTarget(devices, requested, '派发任务'); }
  catch (error) { fail(400, error.message); }
  const cleanWorkdir = typeof workdir === 'string' ? workdir.trim() : '';
  if (cleanWorkdir && !cleanWorkdir.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(cleanWorkdir)) {
    fail(400, '工作目录必须是绝对路径');
  }
  const task = await tasksStore.createTask(ctx.env, {
    title,
    goal,
    deviceId: target.id,
    workdir: cleanWorkdir,
    budget: tasksStore.normalizeBudget(budget),
  });
  const started = startTaskRun(ctx, task);
  return {
    task_id: task.id,
    title: task.title,
    goal: task.goal,
    device: target.id,
    device_name: target.name || target.host || target.id,
    workdir: cleanWorkdir || '设置里配置的工作目录',
    status: started ? 'running' : 'queued',
  };
}

// 开跑。state 结构和普通会话一致，只是额外带 budget / steer 两个标记。
function startTaskRun(ctx, task) {
  const id = task.id;
  if (ctx.runs.has(id)) return false;
  const state = {
    controller: new AbortController(),
    done: null,
    text: '',
    reasoning: '',
    runImages: new Set(),
    kind: 'task',
    budget: '',
    steer: false,
    result: null,
    notificationId: crypto.randomUUID(),
  };
  ctx.runs.set(id, state);
  ctx.markRunning(id);
  state.done = (async () => {
    try {
      const fresh = await tasksStore.patchTask(ctx.env, id, { status: 'running', finished_at: null });
      if (!fresh) return;
      await reply(ctx, id, state, { kind: 'task', task: fresh });
    } catch (error) {
      console.error('任务执行失败：', error.message);
      state.result = { status: 'incomplete', stopReason: 'api_error', error: error.message, text: '' };
      ctx.publish(id, { type: 'error', code: 'api_error', error: error.message });
      ctx.publish(id, { type: 'done', status: 'incomplete', stopReason: 'api_error' });
    } finally {
      try {
        await finishTask(ctx, id, state);
      } finally {
        ctx.runs.delete(id);
        ctx.markIdle(id);
        ctx.waitUntil(flushTaskNotifications(ctx));
      }
    }
  })().catch((error) => console.error('任务收尾失败：', error.message));
  ctx.waitUntil(state.done);
  return true;
}

async function finishTask(ctx, id, state) {
  const task = await tasksStore.getTask(ctx.env, id);
  if (!task) return;
  // 被新指令打断：回到队列，紧接着会按新指令重跑。
  if (state.steer) {
    await tasksStore.patchTask(ctx.env, id, { status: 'queued' });
    return;
  }
  const status = state.result?.status;
  // 任务自己举手要人决定：这一轮正常收了尾，也不能把它盖成"完成"。
  if (task.status === 'needs_human' && !state.budget && status !== 'aborted') {
    await tasksStore.patchTask(ctx.env, id, { finished_at: Date.now() }, {
      id: state.notificationId, result: state.result?.text || task.progress,
    });
    return;
  }
  const next = state.budget ? 'failed' : status === 'completed' ? 'done' : status === 'aborted' ? 'cancelled' : 'failed';
  const lastText = (state.result?.text || '').replace(/\s+/g, ' ').trim();
  const progress =
    state.budget ||
    (next === 'done'
      ? (lastText || task.progress || '完成').slice(0, 120)
      : next === 'cancelled'
        ? task.progress || '已停止'
        : `执行失败：${state.result?.error || state.result?.stopReason || '未知原因'}${lastText ? `（${lastText.slice(0, 60)}）` : ''}`);
  await tasksStore.patchTask(ctx.env, id, { status: next, progress, finished_at: Date.now() }, {
    id: state.notificationId, result: state.result?.error || state.result?.text || progress,
  });
}

// 给任务追加一句话并让它继续：在跑就先打断，再从头带着完整上下文接着干。
async function steerTask(ctx, task, text) {
  const content = typeof text === 'string' ? text.trim() : '';
  if (!content) fail(400, '请输入指令');
  const user = message(content);
  const saved = await store.saveMessage(ctx.env, task.id, user);
  ctx.publish(task.id, { type: 'message', item: user, ...saved });
  const current = ctx.runs.get(task.id);
  if (current) {
    current.steer = true;
    current.controller.abort(new DOMException('收到新指令', 'AbortError'));
    await current.done.catch(() => {});
  }
  const fresh = await tasksStore.getTask(ctx.env, task.id);
  if (!fresh) fail(404, '任务不存在');
  // 结束了的任务被再喊一声，就重新打开。
  if (!tasksStore.OPEN_STATES.includes(fresh.status)) {
    await tasksStore.patchTask(ctx.env, task.id, { status: 'queued', finished_at: null });
  }
  const started = startTaskRun(ctx, (await tasksStore.getTask(ctx.env, task.id)) || fresh);
  return { task_id: task.id, restarted: Boolean(current), running: started };
}

async function cancelTask(ctx, task) {
  const current = ctx.runs.get(task.id);
  if (current) {
    current.controller.abort(new DOMException('用户取消', 'AbortError'));
    await current.done.catch(() => {});
    return { task_id: task.id, cancelled: true };
  }
  await tasksStore.patchTask(ctx.env, task.id, {
    status: 'cancelled',
    progress: task.progress || '已取消',
    finished_at: Date.now(),
  }, { id: crypto.randomUUID(), result: task.progress || '已取消' });
  ctx.waitUntil(flushTaskNotifications(ctx));
  return { task_id: task.id, cancelled: true };
}

async function tasksList(ctx, args) {
  const { status = '', limit = 50 } = pick(args, ['status', 'limit']);
  const rows = await tasksStore.listTasks(ctx.env, { status, limit });
  return { tasks: rows };
}

async function tasksGet(ctx, args) {
  const task = await tasksStore.getTask(ctx.env, pick(args, ['id']).id);
  return { task: requireTaskExists(task) };
}

async function tasksPatch(ctx, args) {
  const { id, title } = pick(args, ['id', 'title']);
  return { task: await tasksStore.renameTask(ctx.env, id, title) };
}

async function tasksDispatch(ctx, args) {
  return dispatchTask(ctx, args);
}

async function tasksSteer(ctx, args) {
  const { id, text } = pick(args, ['id', 'text']);
  const task = requireTaskExists(await tasksStore.getTask(ctx.env, id));
  return steerTask(ctx, task, text);
}

async function tasksCancel(ctx, args) {
  const task = requireTaskExists(await tasksStore.getTask(ctx.env, pick(args, ['id']).id));
  return cancelTask(ctx, task);
}

// 打开（没有就建）助理会话，前端"助理"入口用这个拿 id。
async function routerOpen(ctx) {
  const session = await tasksStore.ensureRouter(ctx.env);
  ctx.waitUntil(flushTaskNotifications(ctx));
  return { id: session.id, title: session.title || '助理' };
}

// 后端投递：与网页是否在线无关。助理忙时不插入消息、不打断当前轮，结束后再排队处理。
export async function flushTaskNotifications(ctx) {
  const control = ctx.notifications;
  const id = tasksStore.ROUTER_ID;
  if (!control || control.running || ctx.runs.has(id)) return;
  control.running = true;
  let state = null;
  let queued = [];
  try {
    queued = await notifications.pending(ctx.env);
    if (!queued.length) return;
    const ids = queued.map((entry) => entry.id);
    try {
      requireModel(await ctx.config());
    } catch (error) {
      await notifications.retry(ctx.env, ids, error.message, { count: false });
      return;
    }
    await tasksStore.ensureRouter(ctx.env);
    // 上面的数据库 / 配置读取期间，人可能已经开始一轮回复，再确认一次再登记。
    if (ctx.runs.has(id)) return;
    state = {
      controller: new AbortController(), done: null, text: '', reasoning: '',
      runImages: new Set(), kind: 'router',
    };
    ctx.runs.set(id, state);
    ctx.markRunning(id);
    state.done = (async () => {
      let attached = 0;
      let lastNotificationMessage = 0;
      for (const notification of queued) {
        const saved = await notifications.materialize(ctx.env, notification);
        if (saved) {
          attached++;
          lastNotificationMessage = Math.max(lastNotificationMessage, saved.id);
          ctx.publish(id, {
            type: 'message', item: message('[任务状态通知]\n' + notification.payload), ...saved,
            trigger: 'task_notification',
          });
        }
      }
      if (!attached) return;
      await reply(ctx, id, state, { notification: true });
      if (['completed', 'aborted'].includes(state.result?.status)) {
        // 用户主动停止时保留通知内容，但不立即再次唤醒同一条通知。
        await notifications.acknowledgeThrough(ctx.env, lastNotificationMessage);
      } else {
        await notifications.retry(ctx.env, ids, state.result?.error);
      }
      ctx.publish(id, { type: 'task_report', status: state.result?.status || 'incomplete', task_ids: queued.map((entry) => entry.task_id) });
    })();
    await state.done;
  } catch (error) {
    console.error('任务通知投递失败：', error.message);
    if (queued.length) await notifications.retry(ctx.env, queued.map((entry) => entry.id), error.message).catch(() => {});
    if (state) {
      ctx.publish(id, { type: 'error', code: 'notification_error', error: error.message });
      ctx.publish(id, { type: 'done', status: 'incomplete', stopReason: 'notification_error', trigger: 'task_notification' });
    }
  } finally {
    if (state && ctx.runs.get(id) === state) {
      ctx.runs.delete(id);
      ctx.markIdle(id);
    }
    control.running = false;
    try {
      const at = await notifications.nextAttempt(ctx.env);
      if (at !== null) {
        if (at <= Date.now() && !ctx.runs.has(id)) ctx.waitUntil(flushTaskNotifications(ctx));
        else ctx.scheduleNotifications(Math.max(Date.now() + 20000, at));
      }
    } catch (error) {
      console.error('安排任务通知失败：', error.message);
      ctx.scheduleNotifications(Date.now() + 60000);
    }
  }
}

/* ───────────────────────── 图片 ───────────────────────── */
// 这两个操作沿用电脑端的协议：上传收 data URL，读取回 base64，前端不用改。

const DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/;

async function imagesUpload(ctx, args) {
  const { id: sessionId = null, image } = pick(args, ['id', 'image']);
  const matched = typeof image === 'string' ? DATA_URL.exec(image) : null;
  if (!matched) {
    fail(400, '只支持 PNG / JPEG / GIF / WebP 图片');
  }
  const bytes = Uint8Array.from(atob(matched[2]), (ch) => ch.charCodeAt(0));
  if (bytes.byteLength > 20 * 1024 * 1024) {
    fail(400, '图片不能超过 20 MiB');
  }
  const saved = await saveImage(ctx.env, { bytes, mime: matched[1], sessionId });
  return { url: saved.url, size: saved.size, type: saved.type };
}

async function imagesGet(ctx, args) {
  const { url } = pick(args, ['url']);
  const name = nameOf(url);
  if (!name) {
    fail(400, '图片地址无效');
  }
  const image = await readImage(ctx.env, name);
  return { type: image.type, data: toBase64(image.bytes) };
}

/* ───────────────────────── 路由 ───────────────────────── */

const OPS = {
  'status.get': status,
  'devices.list': devicesList,
  'devices.patch': devicesPatch,
  'devices.remove': devicesRemove,
  'sessions.list': sessionsList,
  'sessions.create': sessionsCreate,
  'sessions.open': sessionsOpen,
  'sessions.patch': sessionsPatch,
  'sessions.pins': sessionsPins,
  'sessions.remove': sessionsRemove,
  'messages.list': messagesList,
  'usage.stats': usageStats,
  'messages.send': messagesSend,
  'messages.stop': messagesStop,
  'config.get': configGet,
  'config.put': configPut,
  'images.upload': imagesUpload,
  'images.get': imagesGet,
  'tasks.list': tasksList,
  'tasks.get': tasksGet,
  'tasks.patch': tasksPatch,
  'tasks.dispatch': tasksDispatch,
  'tasks.steer': tasksSteer,
  'tasks.cancel': tasksCancel,
  'router.open': routerOpen,
  // 电脑端叫 sessions.remove / run.stop，前端用的是这两个名字。
  'sessions.delete': sessionsRemove,
  'run.stop': messagesStop,
};

export async function callOp(ctx, op, args) {
  const handler = OPS[op];
  if (!handler) {
    fail(404, `没有这个操作：${op}`);
  }
  return handler(ctx, args);
}

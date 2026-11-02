// 云端业务层：会话、消息、配置、图片。对应电脑端 ops/，全部改成 async。
// ctx 由 DO 提供：env / 配置缓存 / runs（内存）+ 广播与设备通道。
import { renderPrompt, requireModel } from './config.js';
import { run } from './loop.js';
import { createRunner } from './runner.js';
import { message } from './ai.js';
import { describeAvailability, listTools } from './tools.js';
import * as store from './store.js';
import { deleteImages, imagesEnabled, nameOf, readImage, saveImage } from './images.js';
import { toBase64 } from './crypto.js';

const { fail, pick } = store;

/* ───────────────────────── 状态 ───────────────────────── */

export async function status(ctx) {
  const config = await ctx.config();
  const device = await store.activeDevice(ctx.env);
  return {
    model: config.model,
    model_ready: Boolean(config.responsesUrl && config.apiKey && config.model),
    workdir: config.workdir || device?.workdir || '',
    device_online: ctx.deviceOnline(),
    browser_connected: Boolean(device?.browser),
    images: imagesEnabled(ctx.env),
    device: device
      ? {
          id: device.id,
          name: device.name,
          platform: device.platform,
          host: device.host,
          workdir: device.workdir,
          browser: Boolean(device.browser),
          last_seen: device.last_seen,
        }
      : null,
  };
}

/* ───────────────────────── 会话 ───────────────────────── */

async function sessionsList(ctx, args) {
  return store.listSessions(ctx.env, args, ctx.runningIds());
}

async function sessionsCreate(ctx, args) {
  pick(args, []);
  return store.createSession(ctx.env);
}

async function sessionsOpen(ctx, args) {
  const { id } = pick(args, ['id']);
  return store.openSession(ctx.env, args, ctx.runs.get(id) || null);
}

async function sessionsPatch(ctx, args) {
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
  return store.publicConfig(ctx.env, await ctx.config());
}

export async function configPut(ctx, args) {
  const patch = pick(args, [
    'responsesUrl', 'apiKey', 'model', 'context_window', 'system', 'compact_at', 'keep',
    'compact_system', 'compact_prefix', 'workdir', 'run_timeout', 'timeout', 'max_output',
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
  return { saved: true };
}

/* ───────────────────────── 消息 ───────────────────────── */

async function messagesList(ctx, args) {
  return store.listMessages(ctx.env, args);
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
    state.done = reply(ctx, id, state).finally(() => {
      ctx.runs.delete(id);
      ctx.markIdle(id);
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

async function reply(ctx, id, state) {
  const env = ctx.env;
  const push = (event) => ctx.publish(id, event);
  const device = await store.activeDevice(env);
  const config = {
    ...(await ctx.config()),
    images_dir: 'r2',
    run_images: state.runImages,
    session_id: id,
    session_title: await store.sessionTitle(env, id),
  };
  const online = ctx.deviceOnline();

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

    await run({
      env,
      instructions: renderPrompt(
        config.system.replace(
          '{{device_status}}',
          describeAvailability({ deviceOnline: online, device, images: imagesEnabled(env) }),
        ),
        device,
      ),
      messages,
      model: config.model,
      config,
      device,
      tools: listTools({ deviceOnline: online }),
      runTool: createRunner({
        env,
        bridge: ctx.bridge,
        sendToDevice: ctx.sendToDevice,
        sessionId: id,
      }),
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
            push(event);
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
  } finally {
    clearTimeout(timer);
    // 没被任何消息引用的工具图片直接删掉，别在 R2 里堆垃圾。
    await deleteImages(env, [...state.runImages].map(nameOf).filter(Boolean));
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

/* ───────────────────────── 设备登记 ───────────────────────── */

async function deviceReport(ctx, args) {
  const data = pick(args, ['id', 'name', 'platform', 'arch', 'host', 'username', 'workdir', 'browser']);
  await store.upsertDevice(ctx.env, data);
  return { ok: true };
}

/* ───────────────────────── 路由 ───────────────────────── */

const OPS = {
  'status.get': status,
  'sessions.list': sessionsList,
  'sessions.create': sessionsCreate,
  'sessions.open': sessionsOpen,
  'sessions.patch': sessionsPatch,
  'sessions.pins': sessionsPins,
  'sessions.remove': sessionsRemove,
  'messages.list': messagesList,
  'messages.send': messagesSend,
  'messages.stop': messagesStop,
  'config.get': configGet,
  'config.put': configPut,
  'device.report': deviceReport,
  'images.upload': imagesUpload,
  'images.get': imagesGet,
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

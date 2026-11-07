// 模型调用：Responses API + SSE 流。从电脑端 ai/index.js 移植，
// 去掉 node:timers/promises 和 Buffer，图片从 R2 取而不是本地目录。
import { dataUrl, nameOf } from './images.js';

export const message = (text, kind = 'input_text', role = 'user') => ({
  type: 'message',
  role,
  content: [{ type: kind, text }],
});

export const outputText = (item) =>
  (Array.isArray(item.content) ? item.content : [])
    .filter((p) => p.type === 'output_text')
    .map((p) => p.text || '')
    .join('');

const decoder = new TextDecoder();

// 可中断的等待：AbortSignal 触发时立刻 reject，等价于 timers/promises 的 delay。
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function boundedBody(response, limit) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        throw new Error('响应超过大小限制');
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return decoder.decode(merged);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// 把本次请求里的 /api/images/xxx 换成 data URL；原消息和事件仍保留短地址。
export async function prepareImages(env, messages, signal) {
  const withImage = (parts) =>
    Array.isArray(parts) && parts.some((part) => part.type === 'input_image' && nameOf(part.image_url));
  const input = [];
  const computerCalls = new Set(messages.filter((item) => item.type === 'function_call' && item.name === 'computer').map((item) => item.call_id));
  const observations = messages.filter((item) => item.type === 'function_call_output' && computerCalls.has(item.call_id) && withImage(item.output));
  const recent = new Set(observations.slice(-2));
  for (const item of messages) {
    signal?.throwIfAborted();
    const parts = item.type === 'function_call_output' ? item.output : item.content;
    if (!withImage(parts)) {
      input.push(item);
      continue;
    }
    const content = [];
    for (const part of parts) {
      const name = part.type === 'input_image' ? nameOf(part.image_url) : null;
      if (name) {
        // 桌面只向模型传最近两张；完整记录仍留在会话中，不反复发送全部历史截图。
        if (computerCalls.has(item.call_id) && !recent.has(item)) {
          content.push({ type: 'input_text', text: '[较早的桌面截图已省略，请依据最新画面操作]' });
          continue;
        }
        // 图片已被删掉或这个部署没有 R2：换成一句说明，别让整次请求失败。
        try {
          content.push({ ...part, image_url: await dataUrl(env, name) });
        } catch (error) {
          if (error.status !== 404) throw error;
          content.push({ type: 'input_text', text: '[图片不可用]' });
        }
      } else {
        content.push(part);
      }
    }
    input.push(item.type === 'function_call_output' ? { ...item, output: content } : { ...item, content });
  }
  return input;
}

export async function readStream(response, onEvent) {
  const reader = response.body.getReader();
  const streamDecoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  let final;
  const dispatch = async (raw) => {
    const data = raw
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    const e = JSON.parse(data);
    if (e.type === 'response.output_text.delta' && e.delta) {
      await onEvent?.({ type: 'message', delta: e.delta });
    }
    if (
      (e.type === 'response.reasoning_text.delta' ||
        e.type === 'response.reasoning_summary_text.delta') &&
      e.delta
    ) {
      await onEvent?.({ type: 'reasoning', delta: e.delta });
    }
    if (e.type === 'response.incomplete') {
      const error = new Error(
        '模型回复未完成：' + (e.response?.incomplete_details?.reason || 'unknown'),
      );
      error.code = 'model_incomplete';
      error.stopReason = e.response?.incomplete_details?.reason || 'model_incomplete';
      throw error;
    }
    if (e.type === 'response.completed') {
      final = e.response;
    }
    if (e.type === 'response.failed') {
      const error = new Error(e.response.error.message);
      error.code = e.response.error.code;
      throw error;
    }
  };
  try {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (cause) {
        const error = new Error(`模型流读取失败：${cause.message}`);
        error.code = 'stream_interrupted';
        throw error;
      }
      const { value, done } = chunk;
      if (done) {
        buffer += streamDecoder.decode();
        if (buffer.trim()) {
          await dispatch(buffer.replace(/\r\n/g, '\n'));
        }
        break;
      }
      size += value.length;
      if (size > 64 * 1024 * 1024) {
        throw new Error('模型流超过大小限制');
      }
      buffer += streamDecoder.decode(value, { stream: true });
      // 先拼接再处理换行，避免 CR 和 LF 分属两个网络片段时丢失边界。
      buffer = buffer.replace(/\r\n/g, '\n');
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        await dispatch(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        if (final) break;
        index = buffer.indexOf('\n\n');
      }
      if (final) break;
    }
    if (!final || !Array.isArray(final.output)) {
      const error = new Error('模型流在结束前中断');
      error.code = 'stream_interrupted';
      throw error;
    }
    return final;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function callModel(env, instructions, messages, model, config, tools = [], onEvent, signal) {
  const payload = {
    instructions,
    input: await prepareImages(env, messages, signal),
    model,
    tools,
    store: false,
  };
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.apiKey}`,
  };
  if (onEvent) {
    payload.stream = true;
    headers.accept = 'text/event-stream';
  }
  const body = JSON.stringify(payload);
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    let delivered = false;
    let phase = 'fetch';
    let retryableHttp = false;
    try {
      const response = await fetch(config.responsesUrl, { method: 'POST', signal, headers, body });
      phase = 'response';
      if (!response.ok) {
        retryableHttp = response.status === 429 || response.status >= 500;
        const raw = await boundedBody(response, 16 * 1024 * 1024);
        let text;
        try {
          text = JSON.parse(raw).error?.message;
        } catch {
          /* 代理可能返回纯文本错误。 */
        }
        const error = new Error(`API HTTP ${response.status}：${text || raw.slice(0, 300)}`);
        error.code = `http_${response.status}`;
        throw error;
      }
      let result;
      if (onEvent) {
        if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
          const error = new Error('流式请求必须返回 text/event-stream');
          error.code = 'invalid_response';
          throw error;
        }
        result = await readStream(response, async (event) => {
          delivered = true;
          await onEvent(event);
        });
      } else {
        result = JSON.parse(await boundedBody(response, 16 * 1024 * 1024));
      }
      if (result.error || result.status !== 'completed' || !Array.isArray(result.output)) {
        const error = new Error(result.error?.message || 'API 返回的 output 无效或未完整生成');
        error.code = result.error?.code || 'invalid_response';
        if (result.status === 'incomplete') {
          error.code = 'model_incomplete';
          error.stopReason = result.incomplete_details?.reason || 'model_incomplete';
        }
        throw error;
      }
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      // 只有尚未交付内容的网络失败、断流和 429/5xx 可以重试。
      const retryable = phase === 'fetch' || retryableHttp || error.code === 'stream_interrupted';
      if (delivered || !retryable) {
        throw error;
      }
      last = error;
      if (attempt < 2) {
        const delayMs = (attempt + 1) * 2000;
        await onEvent?.({
          type: 'retry',
          attempt: attempt + 1,
          maxRetries: 2,
          delayMs,
          error: error.message,
        });
        await delay(delayMs, signal);
      }
    }
  }
  throw last;
}

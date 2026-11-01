import { setTimeout as delay } from "node:timers/promises";
import prepareImages from "./images.js";

export const message = (text, kind = "input_text", role = "user") => ({
  type: "message",
  role,
  content: [{ type: kind, text }],
});
export const outputText = (item) =>
  (Array.isArray(item.content) ? item.content : [])
    .filter((p) => p.type === "output_text")
    .map((p) => p.text || "")
    .join("");

export async function boundedBody(response, limit) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      size += value.length;
      if (size > limit) {
        throw new Error("响应超过大小限制");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let size = 0;
  let final;
  const dispatch = async (raw) => {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) {
      return;
    }
    const e = JSON.parse(data);
    if (e.type === "response.output_text.delta" && e.delta) {
      await onEvent?.({ type: "message", delta: e.delta });
    }
    if (
      (e.type === "response.reasoning_text.delta" ||
        e.type === "response.reasoning_summary_text.delta") &&
      e.delta
    ) {
      await onEvent?.({ type: "reasoning", delta: e.delta });
    }
    if (e.type === "response.incomplete") {
      const error = new Error(
        "模型回复未完成：" + (e.response?.incomplete_details?.reason || "unknown"),
      );
      error.code = "model_incomplete";
      error.stopReason = e.response?.incomplete_details?.reason || "model_incomplete";
      throw error;
    }
    if (e.type === "response.completed") {
      final = e.response;
    }
    if (e.type === "response.failed") {
      const error = new Error(e.response.error.message);
      error.code = e.response.error.code;
      throw error;
    }
    if (e.type === "error") {
      const error = new Error(e.message);
      error.code = e.code;
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
        error.code = "stream_interrupted";
        throw error;
      }
      const { value, done } = chunk;
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) {
          await dispatch(buffer.replace(/\r\n/g, "\n"));
        }
        break;
      }
      size += value.length;
      if (size > 64 * 1024 * 1024) {
        throw new Error("模型流超过大小限制");
      }
      buffer += decoder.decode(value, { stream: true });
      // 先拼接再处理换行，避免 CR 和 LF 分属两个网络片段时丢失边界。
      buffer = buffer.replace(/\r\n/g, "\n");
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        await dispatch(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        if (final) {
          break;
        }
        index = buffer.indexOf("\n\n");
      }
      if (final) {
        break;
      }
    }
    if (!final || !Array.isArray(final.output)) {
      const error = new Error("模型流在结束前中断");
      error.code = "stream_interrupted";
      throw error;
    }
    return final;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function callModel(
  instructions,
  messages,
  model,
  config,
  tools = [],
  onEvent,
  signal,
) {
  const payload = {
    instructions,
    input: await prepareImages(messages, config.images_dir, signal),
    model,
    tools,
    store: false,
  };
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${config.apiKey}`,
  };
  if (onEvent) {
    payload.stream = true;
    headers.accept = "text/event-stream";
  }
  const body = JSON.stringify(payload);
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    let delivered = false;
    let phase = "fetch";
    let retryableHttp = false;
    try {
      const response = await fetch(config.responsesUrl, {
        method: "POST",
        signal,
        headers,
        body,
      });
      phase = "response";
      if (!response.ok) {
        retryableHttp = response.status === 429 || response.status >= 500;
        const raw = (await boundedBody(response, 16 * 1024 * 1024)).toString();
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
        if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
          const error = new Error("流式请求必须返回 text/event-stream");
          error.code = "invalid_response";
          throw error;
        }
        result = await readStream(response, async (event) => {
          delivered = true;
          await onEvent(event);
        });
      } else {
        result = JSON.parse((await boundedBody(response, 16 * 1024 * 1024)).toString());
      }
      if (result.error || result.status !== "completed" || !Array.isArray(result.output)) {
        const error = new Error(result.error?.message || "API 返回的 output 无效或未完整生成");
        error.code = result.error?.code || "invalid_response";
        if (result.status === "incomplete") {
          error.code = "model_incomplete";
          error.stopReason = result.incomplete_details?.reason || "model_incomplete";
        }
        throw error;
      }
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      // 只有尚未交付内容的网络失败、断流和 429/5xx 可以重试。
      // 协议/JSON 错误、模型拒绝和调用方回调错误直接终止。
      const retryable = phase === "fetch" || retryableHttp || error.code === "stream_interrupted";
      if (delivered || !retryable) {
        throw error;
      }
      last = error;
      if (attempt < 2) {
        const delayMs = (attempt + 1) * 2000;
        await onEvent?.({
          type: "retry",
          attempt: attempt + 1,
          maxRetries: 2,
          delayMs,
          error: error.message,
        });
        await delay(delayMs, undefined, { signal });
      }
    }
  }
  throw last;
}

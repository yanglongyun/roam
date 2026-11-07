// 压缩：把早期的对话折成一段中文摘要。逻辑与电脑端一致，只是模型调用多带一个 env。
import { callModel, message, outputText } from './ai.js';
import { renderPrompt } from './config.js';

export default async function compact({
  env,
  messages,
  model,
  config,
  scope = {},
  signal,
  onEvent = () => {},
}) {
  if (messages.length <= config.keep + 2) {
    return null;
  }
  const limit = messages.length - config.keep;
  const pendingCalls = new Set();
  let count = 0;
  // 在新用户消息前或一组工具全部返回后截断，不能拆开调用和结果。
  for (let i = 0; i < limit; i++) {
    const item = messages[i];
    if (item.type === 'function_call') {
      pendingCalls.add(item.call_id);
    } else if (item.type === 'function_call_output') {
      pendingCalls.delete(item.call_id);
    }
    const next = messages[i + 1];
    if (
      pendingCalls.size === 0 &&
      (item.type === 'function_call_output' || (next?.type === 'message' && next.role === 'user'))
    ) {
      count = i + 1;
    }
  }
  if (count <= 1) {
    return null;
  }
  await onEvent({ type: 'compact', status: 'started' });
  const source = messages
    .slice(0, count)
    .map((item) => JSON.stringify(item))
    .join('\n');
  const response = await callModel(
    env,
    renderPrompt(config.compact_system, scope),
    [message(source)],
    model,
    config,
    [],
    (event) => {
      if (event.type === 'retry') {
        return onEvent(event);
      }
    },
    signal,
  );
  signal?.throwIfAborted();
  const summary = response.output.map(outputText).join('');
  if (!summary.trim()) {
    throw new Error('压缩没有返回摘要');
  }
  return {
    item: message(renderPrompt(config.compact_prefix, scope) + summary),
    start: 0,
    end: count,
    usage: response.usage ? { ...response.usage, model } : null,
  };
}

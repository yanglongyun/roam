// 工具分发：sql 在云端直接跑；其余工具转给设备，图片结果存进 R2 再回给模型。
import { runSql } from './sql.js';
import { imagesEnabled, saveImage } from './images.js';
import { DEVICE_TOOLS } from './tools.js';

function parseArgs(raw) {
  if (typeof raw !== 'string') {
    throw new Error('arguments 必须是 JSON 字符串');
  }
  const args = JSON.parse(raw);
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('工具参数必须是对象');
  }
  return args;
}

export function createRunner({ env, bridge, sendToDevice, sessionId }) {
  return async (call, context) => {
    const signal = context?.signal;
    signal?.throwIfAborted();
    try {
      const args = parseArgs(call.arguments);

      if (call.name === 'sql') {
        const result = await runSql(env.DB, args);
        return { text: JSON.stringify(result) };
      }

      if (!DEVICE_TOOLS.has(call.name)) {
        throw new Error(`没有这个工具：${call.name}`);
      }

      const result = await bridge.call({
        name: call.name,
        args,
        send: sendToDevice,
        signal,
        timeoutMs: (context?.config?.timeout || 120) * 1000,
        // 工作目录、超时、输出上限由云端设置说了算，设备只负责按参数执行。
        config: {
          workdir: context?.config?.workdir || '',
          timeout: context?.config?.timeout || 120,
          max_output: context?.config?.max_output || 30000,
          // 浏览器插件按对话建标签组，组名用对话标题。
          session_id: context?.config?.session_id || '',
          session_title: context?.config?.session_title || '',
        },
      });
      if (result.failed) {
        return { text: result.text || '执行失败', failed: true };
      }
      // 设备把图片以 base64 托上来，云端存 R2 并换成 /api/images/ 短地址。
      if (result.image?.base64 && !imagesEnabled(env)) {
        return { text: `${result.text || ''}\n（图片没有保存：这个部署没有绑定 R2，看不到图片内容）`.trim() };
      }
      if (result.image?.base64) {
        const bytes = Uint8Array.from(atob(result.image.base64), (ch) => ch.charCodeAt(0));
        const saved = await saveImage(env, {
          bytes,
          mime: result.image.mime || 'image/png',
          sessionId,
        });
        return { text: result.text || '', imageURL: saved.url };
      }
      return { text: result.text || '' };
    } catch (error) {
      signal?.throwIfAborted();
      return { text: error.message, failed: true };
    }
  };
}

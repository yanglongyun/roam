// 工具分发：sql 在云端直接跑；其余工具转给设备，图片结果存进 R2 再回给模型。
// 目标设备 = 工具参数里的 device；没填时只有一台在线就用它，多台在线必须指定。
// 指定的设备不存在或离线直接失败，绝不落到别的设备。
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

function label(device) {
  return device.name || device.host || device.id;
}

function pickTarget(list, requested, name) {
  const id = typeof requested === 'string' ? requested.trim() : '';
  if (id) {
    const target = list.find((device) => device.id === id);
    if (!target) throw new Error(`设备不存在：${id}。可用设备见系统提示`);
    if (!target.online) throw new Error(`设备「${label(target)}」离线，无法执行 ${name}`);
    return target;
  }
  const online = list.filter((device) => device.online);
  if (online.length === 1) return online[0];
  if (!online.length) throw new Error(`所有设备都离线，无法执行 ${name}`);
  const names = online.map((device) => `「${label(device)}」(${device.id})`).join('、');
  throw new Error(`有 ${online.length} 台设备在线，必须在 device 参数里指定设备 id：${names}`);
}

// devices 是函数：每次工具调用时现取设备清单和在线状态，回复期间设备可能上下线。
export function createRunner({ env, bridge, sendToDevice, sessionId, devices = () => [] }) {
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

      const { device: requested, ...rest } = args;
      const target = pickTarget(devices(), requested, call.name);

      const result = await bridge.call({
        deviceId: target.id,
        name: call.name,
        args: rest,
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

// 任务的设备工具分发：只在绑定设备上执行，图片结果存进 R2。
// pickTarget 供创建任务时选择设备，不参与任务运行中的工具路由。
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

export function pickTarget(list, requested, name) {
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

// 任务绑定的那台设备：不存在或离线都直接失败，不会落到别的设备上。
function boundTarget(list, id, name) {
  const target = list.find((device) => device.id === id);
  if (!target) throw new Error(`任务绑定的设备不存在：${id}`);
  if (!target.online) throw new Error(`任务绑定的设备「${label(target)}」离线，无法执行 ${name}`);
  return target;
}

// devices 是函数：每次工具调用时现取设备清单和在线状态，回复期间设备可能上下线。
// boundDeviceId：任务用。派发时就把设备绑死，工具参数里的 device 一律忽略。
export function createRunner({
  env,
  bridge,
  sendToDevice,
  sessionId,
  devices = () => [],
  boundDeviceId = '',
  // 任务自带的独立工作目录，优先于全局设置。
  workdir = '',
}) {
  return async (call, context) => {
    const signal = context?.signal;
    signal?.throwIfAborted();
    try {
      const args = parseArgs(call.arguments);

      if (!DEVICE_TOOLS.has(call.name)) {
        throw new Error(`没有这个工具：${call.name}`);
      }

      if (!boundDeviceId) throw new Error('任务没有绑定执行设备');
      const { device: _ignored, ...rest } = args;
      const target = boundTarget(devices(), boundDeviceId, call.name);
      if (call.name === 'computer') {
        if (target.platform !== 'darwin') throw new Error('桌面操作目前仅支持 macOS');
        if (!imagesEnabled(env)) throw new Error('桌面操作需要绑定图片存储，模型必须能看到截图');
      }

      const result = await bridge.call({
        deviceId: target.id,
        name: call.name,
        args: rest,
        send: sendToDevice,
        signal,
        timeoutMs: (context?.config?.timeout || 120) * 1000,
        // 工作目录、超时、输出上限由云端设置说了算，设备只负责按参数执行。
        config: {
          workdir: workdir || context?.config?.workdir || '',
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

// 设备工具调用：云端发起 tool.call，等设备回 tool.result。
// 每条等待中的调用都记着目标设备，某台设备断开只判它自己的调用失败。
import { DEVICE_TOOLS } from './tools.js';

const DEFAULT_TIMEOUT = 10 * 60 * 1000;

export class DeviceBridge {
  constructor() {
    // call_id -> { deviceId, resolve, reject, timer }
    this.pending = new Map();
  }

  get size() {
    return this.pending.size;
  }

  // drain 用来在设备断开时把它等待中的调用一次性判失败；不传 deviceId 则全部。
  drain(deviceId = null, reason = '设备已断开') {
    for (const [callId, entry] of this.pending) {
      if (deviceId && entry.deviceId !== deviceId) continue;
      clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error(reason), { code: 'device_offline' }));
      this.pending.delete(callId);
    }
  }

  settle(data) {
    const entry = this.pending.get(data?.call_id);
    if (!entry) return false;
    this.pending.delete(data.call_id);
    clearTimeout(entry.timer);
    entry.resolve(data.result || { text: '', failed: true });
    return true;
  }

  // send 由 DO 提供：send(deviceId, message) 把消息交给该设备的 WebSocket。
  async call({ deviceId, name, args, send, signal, timeoutMs = DEFAULT_TIMEOUT, config = null }) {
    if (!DEVICE_TOOLS.has(name)) {
      throw Object.assign(new Error(`没有这个工具：${name}`), { code: 'unknown_tool' });
    }
    if (!deviceId) {
      throw Object.assign(new Error('没有指定执行设备'), { code: 'device_offline' });
    }
    if (signal?.aborted) throw signal.reason;
    const callId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        try { send(deviceId, { type: 'tool.cancel', to: 'desktop', data: { call_id: callId } }); } catch {}
      };
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        cancel();
        done(reject)(Object.assign(new Error(`设备执行超时：${name}`), { code: 'tool_timeout' }));
      }, timeoutMs);
      const onAbort = () => {
        this.pending.delete(callId);
        clearTimeout(timer);
        cancel();
        done(reject)(signal.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const done = (fn) => (value) => {
        signal?.removeEventListener('abort', onAbort);
        fn(value);
      };
      this.pending.set(callId, {
        deviceId,
        timer,
        resolve: done(resolve),
        reject: done(reject),
      });
      try {
        const delivered = send(deviceId, {
          type: 'tool.call',
          to: 'desktop',
          data: { call_id: callId, name, arguments: args, config },
        });
        if (!delivered) {
          this.pending.delete(callId);
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(Object.assign(new Error('设备离线，无法执行这个工具'), { code: 'device_offline' }));
        }
      } catch (error) {
        this.pending.delete(callId);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      }
    });
  }
}

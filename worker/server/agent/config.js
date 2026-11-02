// 云端配置：默认值与校验。与电脑端不同的是，环境信息来自 devices 表的快照，
// 不再读本机 os / fs —— Worker 上没有"用户电脑"这回事。

export const defaults = () => ({
  responsesUrl: 'https://api.openai.com/v1/responses',
  apiKey: '',
  model: 'gpt-4o-mini',
  context_window: 0,
  system:
    '你是运行在云端的 AI agent，数据存在云端数据库里；需要时可把 shell / read / write / edit / browser 这些工具调用转发给用户已连接的设备执行。\n\n' +
    '环境：{{os}}/{{arch}}，主机 {{host}}，用户 {{user}}，工作目录 {{workdir}}，时间 {{time}}。\n' +
    '{{device_status}}\n' +
    '改文件前先读取。破坏性操作执行前说明目标。根据工具结果继续工作，不确定时检查，不要猜。回答简洁。',
  compact_at: 60000,
  keep: 20,
  compact_system:
    '把下面对话压成中文交接摘要。保留目标、要求、完成事项、改过的文件、当前进度、待办和关键命令。不要开场白。',
  compact_prefix: '以下是历史上下文压缩摘要：\n\n',
  workdir: '',
  run_timeout: 600,
  timeout: 120,
  max_output: 30000,
});

// 只校验这个应用自己用的字段。工作目录的"是否真的存在"由设备侧校验，
// 云端只看它是不是绝对路径。
export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('配置必须是对象');
  }
  for (const key of [
    'responsesUrl',
    'apiKey',
    'model',
    'system',
    'compact_system',
    'compact_prefix',
    'workdir',
  ]) {
    if (typeof config[key] !== 'string') {
      throw new Error(`${key} 必须是字符串`);
    }
  }
  for (const key of [
    'context_window',
    'compact_at',
    'keep',
    'run_timeout',
    'timeout',
    'max_output',
  ]) {
    const minimum = key === 'context_window' ? 0 : 1;
    if (!Number.isSafeInteger(config[key]) || config[key] < minimum) {
      throw new Error(`${key} 必须是大于等于 ${minimum} 的整数`);
    }
  }
  if (config.context_window > 0 && config.compact_at >= config.context_window) {
    throw new Error('压缩阈值必须小于模型上下文窗口');
  }
  if (config.responsesUrl) {
    let address;
    try {
      address = new URL(config.responsesUrl);
    } catch {
      throw new Error('模型接口地址无效');
    }
    if (!['http:', 'https:'].includes(address.protocol)) {
      throw new Error('模型接口地址必须使用 HTTP 或 HTTPS');
    }
  }
  if (config.workdir && !config.workdir.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(config.workdir)) {
    throw new Error('工作目录必须是绝对路径');
  }
}

export function requireModel(config) {
  if (!config.responsesUrl || !config.apiKey || !config.model) {
    throw new Error('尚未配置模型：请在设置中填写接口地址、API Key 和模型');
  }
}

// 占位符来自设备快照；设备没连过就用中性默认值，别让提示词里露出 {{host}}。
export function renderPrompt(text, device = null) {
  const values = {
    os: device?.platform || '未知系统',
    arch: device?.arch || '',
    host: device?.host || '未连接设备',
    user: device?.username || '未知用户',
    workdir: device?.workdir || '未知目录',
    time: new Date().toISOString(),
    device_status: '',
  };
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => values[name] ?? match);
}

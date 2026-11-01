import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";

export const defaults = () =>
  JSON.parse(fs.readFileSync(new URL("./defaults.json", import.meta.url)));

// 助理的数据都在电脑端 ~/.roam/agent/，不经过 Worker。
export function paths(home = os.homedir()) {
  const root = path.join(home, ".roam", "agent");
  return {
    root,
    config: path.join(root, "config.json"),
    db: path.join(root, "chat.db"),
    images: path.join(root, "images"),
    // 浏览器插件经原生消息宿主连到这个本机管道
    browser:
      process.platform === "win32"
        ? `\\\\.\\pipe\\roam-browser-${os.userInfo().username}`
        : path.join(root, "browser.sock"),
  };
}

// 只校验这个应用自己用的字段；别处写进 config.json 的字段原样保留，不认识的不报错。
export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("配置必须是对象");
  }
  for (const key of [
    "responsesUrl",
    "apiKey",
    "model",
    "system",
    "compact_system",
    "compact_prefix",
    "workdir",
  ]) {
    if (typeof config[key] !== "string") {
      throw new Error(`${key} 必须是字符串`);
    }
  }
  for (const key of [
    "context_window",
    "compact_at",
    "keep",
    "run_timeout",
    "timeout",
    "max_output",
  ]) {
    const minimum = key === "context_window" ? 0 : 1;
    if (!Number.isSafeInteger(config[key]) || config[key] < minimum) {
      throw new Error(`${key} 必须是大于等于 ${minimum} 的整数`);
    }
  }
  if (config.context_window > 0 && config.compact_at >= config.context_window) {
    throw new Error("压缩阈值必须小于模型上下文窗口");
  }
  if (config.responsesUrl) {
    let address;
    try {
      address = new URL(config.responsesUrl);
    } catch {
      throw new Error("模型接口地址无效");
    }
    if (!["http:", "https:"].includes(address.protocol)) {
      throw new Error("模型接口地址必须使用 HTTP 或 HTTPS");
    }
  }
  if (
    config.workdir &&
    (!path.isAbsolute(config.workdir) || !fs.statSync(config.workdir).isDirectory())
  ) {
    throw new Error("工作目录必须是已存在的绝对目录");
  }
}

export function saveConfig(locations, config) {
  validateConfig(config);
  fs.mkdirSync(locations.root, { recursive: true, mode: 0o700 });
  const temp = `${locations.config}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(temp, locations.config);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// 读配置。文件不存在就写一份默认的；别处留下的文件缺了本应用的字段，补上默认值并写回。
export function loadConfig(locations = paths()) {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(locations.config, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`配置文件读取失败：${error.message}`);
    }
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error("配置必须是对象");
  }
  const config = { ...defaults(), ...stored };
  validateConfig(config);
  if (Object.keys(config).some((key) => !(key in stored))) {
    saveConfig(locations, config);
  }
  return config;
}

export function requireModel(config) {
  if (!config.responsesUrl || !config.apiKey || !config.model) {
    throw new Error("尚未配置模型：请在设置中填写接口地址、API Key 和模型");
  }
}

export function renderPrompt(text, workdir = os.homedir()) {
  const values = {
    os: process.platform === "win32" ? "windows" : process.platform,
    arch: process.arch === "x64" ? "amd64" : process.arch,
    host: os.hostname(),
    user: os.userInfo().username,
    workdir: workdir || os.homedir(),
    time: new Date().toISOString(),
  };
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => values[name] ?? match);
}

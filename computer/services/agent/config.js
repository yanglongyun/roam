import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 工具执行的本地参数：云端只发工具名和参数，目录、超时、输出上限由这台电脑决定。
export const defaults = () =>
  JSON.parse(fs.readFileSync(new URL("./defaults.json", import.meta.url)));

// 助理在本机只留两个东西：浏览器插件的管道，和图片工具的临时目录。
export function paths(home = os.homedir()) {
  const root = path.join(home, ".roam", "agent");
  return {
    root,
    images: path.join(root, "images"),
    // 浏览器插件经原生消息宿主连到这个本机管道
    browser:
      process.platform === "win32"
        ? `\\\\.\\pipe\\roam-browser-${os.userInfo().username}`
        : path.join(root, "browser.sock"),
  };
}

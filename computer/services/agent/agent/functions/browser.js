import { saveImage } from "../../images.js";

const actions = ["tabs", "open", "close", "detach", "cdp", "chrome"];

// 把命令交给浏览器插件执行。页面操作是原样转发的 CDP 命令，扩展接口走 chrome 动作，结果原样返回给模型；
// 截图的 base64 存成图片文件，作为图片交给模型。
export default async function browser(args, config, signal) {
  if (!actions.includes(args.action)) {
    throw new Error(`action 必须是 ${actions.join(" / ")} 之一`);
  }
  if (!config.browser) {
    throw new Error("浏览器插件未连接：请在 Chrome 或 Edge 里安装并启用 Roam 插件");
  }
  const { action, ...rest } = args;
  // 带上对话信息，插件按对话把标签页放进以标题命名的标签组。
  const session = { id: config.session_id, title: config.session_title };
  const result = await config.browser.request(action, { ...rest, session }, signal);
  if (action === "tabs") {
    if (!result.tabs.length) {
      return { text: "没有打开的标签页，用 open 打开网页" };
    }
    const lines = result.tabs.map((tab) => {
      const marks = [
        tab.group && `组：${tab.group}`,
        tab.active && "当前页",
        tab.mine && "你打开的",
      ].filter(Boolean);
      return `[tab ${tab.tab}] ${tab.title}${marks.length ? `（${marks.join("，")}）` : ""}\n${tab.url}`;
    });
    return { text: limit(lines.join("\n"), config.max_output) };
  }
  if (action === "close") {
    return { text: `已关闭 tab ${result.closed}` };
  }
  if (action === "detach") {
    return { text: `已断开 tab ${result.detached} 的调试` };
  }
  if (action === "chrome") {
    return { text: limit(JSON.stringify(result, null, 2), config.max_output) };
  }
  if (action === "open") {
    return { text: `[tab ${result.tab}] ${result.title}\n${result.url}` };
  }
  // 页面脚本抛错时 CDP 会在结果里带 exceptionDetails，当作工具失败。
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    throw new Error(detail.exception?.description || detail.text || "脚本执行出错");
  }
  if (args.method === "Page.captureScreenshot" && typeof result.data === "string") {
    let extension = ".png";
    if (args.params?.format === "jpeg") {
      extension = ".jpeg";
    } else if (args.params?.format === "webp") {
      extension = ".webp";
    }
    const imageURL = await saveImage(
      config.images_dir,
      Buffer.from(result.data, "base64"),
      extension,
      signal,
    );
    config.run_images?.add(imageURL);
    return { text: "已截图", imageURL };
  }
  return { text: limit(JSON.stringify(result, null, 2), config.max_output) };
}

function limit(text, max) {
  return text.length > max ? text.slice(0, max) + "\n…（输出已截断）" : text;
}

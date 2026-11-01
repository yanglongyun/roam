// Roam 浏览器插件：通过原生消息连上 Roam 电脑端，接收助理的命令。
// 页面里面的事一律转发给 Chrome 开发者工具协议（CDP）；标签页和标签组用插件接口管理。
// 只操作 Agent 自己打开的标签页；每个对话的标签页放进一个以对话标题命名的标签组。
// 鼠标键盘事件和截图需要标签页在前台，插件会自动切过去。
// Agent 操作期间浏览器顶部会显示“正在调试此浏览器”，这是 Chrome 对 debugger 权限的强制提示。
const HOST = "yun.roam.browser";
let port = null;

// Roam 电脑端没开时连不上；每 30 秒由定时器唤醒重试一次。
function connect() {
  if (port) {
    return;
  }
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((message) => void handle(message));
  port.onDisconnect.addListener(() => {
    port = null;
    void chrome.action.setBadgeText({ text: "" });
  });
  void chrome.action.setBadgeBackgroundColor({ color: "#2f6df6" });
  void chrome.action.setBadgeText({ text: "on" });
}
chrome.alarms.create("connect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

async function handle(message) {
  try {
    const result = await run(message.action, message.args || {});
    port?.postMessage({ id: message.id, result });
  } catch (error) {
    port?.postMessage({ id: message.id, error: error.message });
  }
}

// args.session 是 { id, title }：命令来自哪个对话，用来决定标签组。
async function run(action, args) {
  switch (action) {
    case "tabs":
      return listTabs();
    case "open":
      return openTab(args);
    case "close": {
      const id = await agentTab(args.tab);
      await chrome.tabs.remove(id);
      await forget(id);
      return { closed: id };
    }
    case "cdp": {
      const id = await agentTab(args.tab);
      if (typeof args.method !== "string" || !args.method) {
        throw new Error("缺少 method");
      }
      // 后台标签页不处理鼠标键盘事件，截图也可能卡住：这类命令先把标签页切到前台。
      if (args.method.startsWith("Input.") || args.method === "Page.captureScreenshot") {
        if (!(await chrome.tabs.get(id)).active) {
          await cdp(id, "Page.bringToFront", {});
          await sleep(200);
        }
      }
      return cdp(id, args.method, args.params || {});
    }
    default:
      throw new Error(`不支持的操作：${action}`);
  }
}

// ── Agent 的标签页 ──────────────────────────────────────────
// 标签页 ID 和对话对应的标签组记在会话存储里，插件后台被浏览器挂起再唤醒也不会丢。
async function agentTabs() {
  const { tabs = [] } = await chrome.storage.session.get("tabs");
  return tabs;
}
async function remember(id) {
  const tabs = await agentTabs();
  if (!tabs.includes(id)) {
    await chrome.storage.session.set({ tabs: [...tabs, id] });
  }
}
async function forget(id) {
  const tabs = await agentTabs();
  await chrome.storage.session.set({ tabs: tabs.filter((tab) => tab !== id) });
}
chrome.tabs.onRemoved.addListener((id) => void forget(id));

async function agentTab(id) {
  if (!Number.isInteger(id)) {
    throw new Error("缺少 tab");
  }
  if (!(await agentTabs()).includes(id)) {
    throw new Error("只能操作 Roam 助理自己打开的标签页，请先用 open 打开");
  }
  return id;
}

async function describe(id) {
  const tab = await chrome.tabs.get(id);
  let group = "";
  if (tab.groupId >= 0) {
    group = (await chrome.tabGroups.get(tab.groupId)).title || "";
  }
  return { tab: tab.id, title: tab.title || "", url: tab.url || "", group };
}

async function listTabs() {
  const tabs = [];
  for (const id of await agentTabs()) {
    try {
      tabs.push(await describe(id));
    } catch {
      await forget(id);
    }
  }
  return { tabs };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 等页面加载完成，最多 15 秒；超时也返回当前状态，交给 Agent 判断。
async function waitLoad(id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if ((await chrome.tabs.get(id)).status === "complete") {
      return;
    }
    await sleep(200);
  }
}

// 不带 tab 时新开一个标签页，放进这个对话的标签组；带 tab 时在这个标签页里跳转。
async function openTab(args) {
  if (typeof args.url !== "string" || !/^https?:\/\//.test(args.url)) {
    throw new Error("url 必须是 http 或 https 地址");
  }
  let id;
  if (args.tab === undefined) {
    const tab = await chrome.tabs.create({ url: args.url, active: false });
    id = tab.id;
    await remember(id);
    await addToGroup(id, args.session);
  } else {
    id = await agentTab(args.tab);
    await chrome.tabs.update(id, { url: args.url });
  }
  // 刚发起跳转时状态可能还是上一个页面的 complete，先等一下再看。
  await sleep(300);
  await waitLoad(id);
  return describe(id);
}

// 每个对话一个标签组，组名是对话标题；标题改了下次打开时跟着改。用户关掉了组就新建一个。
async function addToGroup(id, session) {
  const key = session?.id || "";
  let title = "Roam";
  if (session?.title) {
    title = session.title.slice(0, 40);
  }
  const { groups = {} } = await chrome.storage.session.get("groups");
  if (groups[key] !== undefined) {
    try {
      await chrome.tabs.group({ groupId: groups[key], tabIds: [id] });
      await chrome.tabGroups.update(groups[key], { title });
      return;
    } catch {
      // 标签组已经不在了，下面新建一个。
    }
  }
  const groupId = await chrome.tabs.group({ tabIds: [id] });
  await chrome.tabGroups.update(groupId, { title, color: "blue" });
  await chrome.storage.session.set({ groups: { ...groups, [key]: groupId } });
}

// ── CDP ────────────────────────────────────────────────────
const attached = new Set();
chrome.debugger.onDetach.addListener((source) => attached.delete(source.tabId));

// 第一次操作某个标签页时挂上调试器，之后一直挂着，直到标签页关闭。
async function cdp(id, method, params) {
  if (!attached.has(id)) {
    try {
      await chrome.debugger.attach({ tabId: id }, "1.3");
    } catch (error) {
      if (!/already attached/i.test(error.message)) {
        throw new Error(`无法控制这个标签页：${error.message}（打开了开发者工具时会冲突）`);
      }
    }
    attached.add(id);
  }
  return chrome.debugger.sendCommand({ tabId: id }, method, params);
}

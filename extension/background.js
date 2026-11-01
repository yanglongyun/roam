// browser-use — 用一条 WebSocket 驱动 Chrome 的 CDP 通道。
//
// 设计：插件只是一根“管子”——连上你填的 wss，把收到的命令灌给 chrome.debugger
// （= Chrome DevTools Protocol），把结果/事件回传。没有高层 helper：控制端（AI/agent）
// 直接发 CDP，绝大多数 DOM 操作用 Runtime.evaluate 跑 JS 即可。
//
// 线协议（与具体项目无关）：
//   收  {id, method, params, meta?}        method ∈ cdp | attach | detach | listTabs | status | ping
//   回  {id, ok:true, result, meta?}  /  {id, ok:false, error, meta?}
//   事件 {type:"event", tabId, method, params}     （CDP 事件原样推回）
// meta 原样回显——中枢(Worker)把“谁发的”塞进 meta 用于回包路由，插件不关心路由。
//
// session/token 都在 wss 的 query 里，由中枢/Worker 校验；插件只管连那条 URL。

const CDP_VERSION = "1.3";
const KEEPALIVE_ALARM = "browser-use-keepalive";

let ws = null;
let connected = false;
let reconnectDelay = 1000;
let reconnectTimer = null;
const attached = new Set(); // 已 attach debugger 的 tabId

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

function setBadge() {
  try {
    chrome.action.setBadgeText({ text: connected ? "on" : "" });
    chrome.action.setBadgeBackgroundColor({ color: connected ? "#19a85e" : "#888888" });
  } catch {}
}

async function loadUrl() {
  const { wsUrl } = await chrome.storage.local.get("wsUrl");
  return (wsUrl || "").trim();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

async function connect() {
  clearTimeout(reconnectTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = await loadUrl();
  if (!url) { connected = false; setBadge(); return; }
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    connected = true;
    reconnectDelay = 1000;
    setBadge();
    send({ type: "hello", role: "browser-use", version: chrome.runtime.getManifest().version });
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  };
  ws.onclose = () => { connected = false; setBadge(); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) { try { ws.close(); } catch {} ws = null; }
  connected = false;
  setBadge();
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ? tab.id : undefined;
}

async function ensureAttached(tabId) {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, CDP_VERSION);
  attached.add(tabId);
}

async function handle(msg) {
  if (!msg || msg.type === "pong" || msg.type === "hello") return;
  const { id, method, params = {}, meta } = msg;
  if (id == null || !method) return; // 不是请求就忽略
  try {
    let result;
    switch (method) {
      case "ping":
        result = { pong: true };
        break;
      case "status":
        result = { connected, attached: [...attached] };
        break;
      case "listTabs": {
        const tabs = await chrome.tabs.query({});
        result = tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId }));
        break;
      }
      case "attach": {
        const tabId = params.tabId ?? (await activeTabId());
        if (tabId == null) throw new Error("no tab to attach");
        await ensureAttached(tabId);
        result = { tabId };
        break;
      }
      case "detach": {
        const tabId = params.tabId;
        if (tabId != null && attached.has(tabId)) {
          await chrome.debugger.detach({ tabId });
          attached.delete(tabId);
        }
        result = { detached: tabId ?? null };
        break;
      }
      case "cdp": {
        // params: { tabId?, method: "Page.navigate", params: {...} }
        const tabId = params.tabId ?? (await activeTabId());
        if (tabId == null) throw new Error("no tab for cdp");
        await ensureAttached(tabId);
        result = await chrome.debugger.sendCommand({ tabId }, params.method, params.params || {});
        break;
      }
      default:
        throw new Error("unknown method: " + method);
    }
    send({ id, ok: true, result, meta });
  } catch (e) {
    send({ id, ok: false, error: String((e && e.message) || e), meta });
  }
}

// CDP 事件 → 推回中枢（控制端可订阅 Page.loadEventFired、Network.* 等）
chrome.debugger.onEvent.addListener((source, method, params) => {
  send({ type: "event", tabId: source.tabId, method, params });
});
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId != null) attached.delete(source.tabId);
  send({ type: "event", tabId: source.tabId, method: "_detached", params: { reason } });
});
chrome.tabs.onRemoved.addListener((tabId) => attached.delete(tabId));

// popup 控制
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req && req.cmd === "getStatus") { sendResponse({ connected, attached: [...attached] }); return; }
  if (req && req.cmd === "connect") { connect(); sendResponse({ ok: true }); return; }
  if (req && req.cmd === "disconnect") { disconnect(); sendResponse({ ok: true }); return; }
  return false;
});

// 改了地址就重连
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.wsUrl) { disconnect(); connect(); }
});

// MV3 保活 + 守连：~30s 一次（心跳会重置 SW 闲置计时；断了就重连）
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== KEEPALIVE_ALARM) return;
  if (connected) send({ type: "ping" });
  else connect();
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect(); // SW 冷启动也连一次

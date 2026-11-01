const $ = (id) => document.getElementById(id);
let isConnected = false;

async function refresh() {
  const { wsUrl } = await chrome.storage.local.get("wsUrl");
  if (document.activeElement !== $("url")) $("url").value = wsUrl || "";
  chrome.runtime.sendMessage({ cmd: "getStatus" }, (s) => {
    isConnected = !!(s && s.connected);
    document.body.classList.toggle("connected", isConnected);
    $("status").textContent = isConnected
      ? `已连接 · 附加 ${s.attached ? s.attached.length : 0} 个标签`
      : (wsUrl ? "未连接" : "未配置");
    const btn = $("toggle");
    btn.textContent = isConnected ? "断开" : "连接";
    btn.classList.toggle("on", isConnected);
  });
}

$("toggle").onclick = async () => {
  if (isConnected) {
    chrome.runtime.sendMessage({ cmd: "disconnect" }, () => setTimeout(refresh, 150));
  } else {
    await chrome.storage.local.set({ wsUrl: $("url").value.trim() }); // 触发 background 连接
    setTimeout(refresh, 400);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  try { $("ver").textContent = "v" + chrome.runtime.getManifest().version; } catch {}
  refresh();
});
setInterval(refresh, 1500);

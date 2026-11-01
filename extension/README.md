# browser-use

用**一条 WebSocket** 驱动 Chrome 的 **CDP（Chrome DevTools Protocol）通道**。

插件本身只是一根“管子”:连上你填的 `wss` 地址,把收到的命令灌给 `chrome.debugger`(= CDP),把结果与事件回传。**没有高层封装** —— 控制端(AI / agent)直接发 CDP,绝大多数 DOM 操作用 `Runtime.evaluate` 跑 JS 即可。做一次,任何项目(roam / one / …)填上自己的地址就能用。

## 装 & 用
1. `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选本目录。
2. 点扩展图标,填一条 wss(把 `session`/`token` 写进 query,由对端校验):
   ```
   ws://127.0.0.1:9510/cdp?token=<session id>   # Roam:computer 启动日志里会打印这条地址
   ```
3. 显示「已连接」(角标 `on`)即就绪。对端就能驱动**你这台机器、真实登录态的 Chrome**。

## 线协议(与项目无关)
```
收   {id, method, params, meta?}
回   {id, ok:true,  result, meta?}
     {id, ok:false, error,  meta?}
事件 {type:"event", tabId, method, params}     // CDP 事件原样推回
```
`meta` 原样回显 —— 中枢(如 Worker)把“谁发的”塞进 `meta`,用于把回包路由回请求方;插件不关心路由。`session`/`token` 在 URL 的 query 里,由对端鉴权,插件只负责连。

### method
| method | params | 说明 |
|---|---|---|
| `cdp` | `{ tabId?, method, params }` | **核心**:转发任意 CDP 命令;`tabId` 省略则用当前活动标签,未 attach 会自动 attach |
| `attach` | `{ tabId? }` | 附加 debugger 到某标签(默认活动标签) |
| `detach` | `{ tabId }` | 解除 |
| `listTabs` | — | 列出所有标签 `{id,url,title,active,windowId}` |
| `status` | — | `{connected, attached:[tabId]}` |
| `ping` | — | `{pong:true}` |

### 例子(控制端发什么)
```jsonc
// 打开网页
{ "id": 1, "method": "cdp", "params": { "method": "Page.navigate", "params": { "url": "https://example.com" } } }

// 点按钮 / 填表单 / 抓数据 —— 用 JS,一条搞定，支持 await 与真实返回值
{ "id": 2, "method": "cdp", "params": { "method": "Runtime.evaluate",
  "params": { "expression": "document.querySelector('button.buy')?.click()", "awaitPromise": true, "returnByValue": true } } }

// 整页截图(喂视觉模型)
{ "id": 3, "method": "cdp", "params": { "method": "Page.captureScreenshot", "params": { "captureBeyondViewport": true, "format": "jpeg", "quality": 70 } } }

// 真实可信点击(JS .click() 不被认时):取坐标 → 派发鼠标事件
{ "id": 4, "method": "cdp", "params": { "method": "Input.dispatchMouseEvent",
  "params": { "type": "mousePressed", "x": 120, "y": 240, "button": "left", "clickCount": 1 } } }
```
CDP 全集(Page / Runtime / DOM / Input / Network / Fetch / Emulation / Browser / Accessibility / Storage …)都能透传,所以**新场景无需改插件,发新的 CDP 命令即可**。

## 边界 / 注意
- **仅 Chromium**(Chrome/Edge/Brave);出不了浏览器(OS 级对话框/别的 App 不归它管)。
- 顶部会有「正在调试此浏览器」横幅(`chrome.debugger` 固有,关不掉)。
- **安全**:能连上 = 能驱动你的浏览器。把那条 wss 当密码;`token` 由对端校验,应可吊销 + 过期;建议给浏览器发**独立窄权限令牌**。
- **MV3 保活**:MVP 用 `alarms`(~30s)+ WebSocket 活动维持 Service Worker;长时间空闲可能短暂断开后自动重连。要更稳可改用 offscreen document 常驻 WS(TODO)。

## 权限
`debugger`(CDP)· `tabs`· `storage`(存地址)· `alarms`(保活)· `host_permissions: <all_urls>`。

MIT。

# roam

在手机上继续使用电脑里的 Claude Code / Codex。任意数量的电脑端主动连 Cloudflare Worker（带 `DEVICE_TOKEN` 和自己的 `device_id`）；网页只连 Worker，访问密码由 Worker 校验。终端 / 文件 / 屏幕只经 Worker 中继；助理（模型调用、会话、消息、图片）跑在 Worker 的 Durable Object 里，电脑端只负责执行 shell / 文件 / 浏览器这些工具。

- origin: `https://github.com/yanglongyun/roam.git`

## 结构

- `worker/`：Cloudflare Worker + Vue 前端；只有一个 Durable Object `TerminalSessionManager`（`idFromName('hub')`），承载所有 WebSocket、鉴权、终端中继和助理。
- `worker/server/index.js`：hub 本体。网页 `auth.submit { password }` 对 `env.ACCESS_PASSWORD` 做 timingSafeEqual，通过后发 30 天令牌；错 10 次锁 30 分钟（计数在 DO storage），锁定时清空所有令牌；DO 启动时比对 `ACCESS_PASSWORD` 的指纹（存在 storage 的 `passwordFingerprint`，是 SHA-256 不是密码），变了就清空所有令牌——改 secret 会重新部署、DO 必然重启，所以只在构造函数里比；没设 `ACCESS_PASSWORD` 时网页一律 `auth.state { closed }`。电脑端 socket 打 tag `desktop:<device_id>`，`sendToDevice(deviceId, msg)` 按 tag 发；同一 device_id 重连会把旧连接 4002 关掉。`connection.devices` 给网页的是设备列表（D1 登记 + 在线状态）；`web.joined { clientId }` 通知各电脑端把终端快照发给刚登录的网页。
- `worker/server/agent/`：助理本体：`api.js` 的 `callOp` 是网页用的 op 表（含 `devices.list / patch / remove`，`sessions.create` 收 `device_id`，`sessions.patch` 可改 `device_id`），`runner.js` 解析工具参数里的 `device`（没有就用会话默认设备；不存在 / 离线直接失败，不落到别的设备），`rpc.js` 是设备工具桥（pending 按 device_id 记，断开只 drain 自己的），`tools.js` 里五个设备工具都带可选 `device`，`describeDevices` / `describeAvailability` 生成系统提示里的设备清单，`config.js` 的 `renderPrompt(text, { devices, sessionDeviceId })` 支持 `{{devices}}`（旧的 `{{os}}` 等取会话默认设备）。数据在 D1 + R2（`schema.sql`；旧库升级跑 `migrate.sql`）。
- `computer/`：电脑端，每台电脑一份；配置在 `config.js`（或 `.env` / 环境变量），必填 `CLOUDFLARE_WORKER_URL` 和 `DEVICE_TOKEN`，可选 `DEVICE_NAME`、`DEVICE_DESCRIPTION`；`DEBUG=1` 只认环境变量。设备 id 由 `core/device.js` 首次生成写入 `~/.roam/device.json`。密码校验已经不在电脑端（没有 guard 了）。
- `computer/services/agent/`：电脑端只剩工具执行（`agent/functions/*`）和浏览器桥，`device.report` 上报 id / 名字 / 描述 / 环境，`tool.result` 发 `to: 'server'`。
- `computer/services/agent/browser/`：对应 agentic launcher 的浏览器桥、原生消息宿主和宿主登记；宿主名 `yun.roam.browser`。
- `extension/`：Roam 浏览器插件（取自 agentic 插件），manifest 里的 key 决定固定 ID `opkcnndhnmkilimegkcgeecanhjebpge`，要和 `register-host.js` 一致。权限按最高能力给：`debugger` + `<all_urls>` + 所有标签页，`chrome` 动作开放 tabs / windows / tabGroups / downloads / cookies / history / bookmarks / sessions / topSites 这几个命名空间；browsingData、management、proxy 这类改浏览器本身的故意不开。浏览器工具的执行在 `computer/services/agent/agent/functions/browser.js`，给模型的说明在 `worker/server/agent/tools.js`，三处要一起改。
- `worker/src/`：前端。`stores/ws.js` 持有 `devices` 和 `currentDeviceId`（localStorage），`sendToDevice(type, data)` 发到 `device:<id>`；来自设备的消息带 `meta.deviceId`，不是当前设备的在 store 里就丢掉。顶栏 `DevicePicker` 选设备，终端 / 文件 / 屏幕 / 状态都跟它走，切换时各 store 自己清空重拉。对话页 `DeviceBar` 显示 / 切换会话默认设备（草稿时跟随顶栏）。设置页有设备区（改名字、描述，删离线设备的登记）。

## 链路

```
远程浏览器 ×N ──wss（密码云端校验）──> hub DO（终端中继 + 助理 + D1/R2） ──wss + DEVICE_TOKEN + device_id──> Roam Computer ×N
```

## 消息路由

- `to: 'web'` 全部已登录网页；`to: 'web:<clientId>'` 某个网页；`to: 'device:<id>'` 某台电脑（只有网页能发）；`to: 'hub'` / `'server'` 是给 DO 自己的（`auth.submit`、`agent.request`、`device.report`、`tool.result`、`devices.list`），DO 按 type 拦截，不看 to。
- DO 转发来自电脑端的消息时补 `meta.deviceId`；来自网页的补 `meta.clientId`。

## 能力

- 远程终端、AI 助理（设备上执行 shell / read / write / edit / browser，云端执行 sql；Responses 接口，重试、上下文压缩）、文件浏览/读取/上传/重命名/删除、屏幕截图、多设备。
- 网页发 `agent.request {reqId, op, args}`，回 `agent.result`；助理事件经 `agent.event` 推送（`session_id` + 事件字段平铺，事件类型 `message` / `reasoning`（带 `delta` 是流式片段，带 `item` 是完整一项）/ `function_call` / `function_call_output` / `usage` / `compact`（`status` 为 started / completed）/ `retry` / `error` / `done`）。
- API Key 用 `SETTINGS_KEY` 加密后存 D1，只在 DO 里解密使用；模型请求从 Worker 发出，电脑端只收 `tool.call`。
- 电脑端接入要带 `Authorization: Bearer <DEVICE_TOKEN>` 和 `device_id`（`[A-Za-z0-9_-]{8,64}`），Worker 在转给 DO 之前校验令牌，不对就 401。
- `devices.name / description` 以云端为准：电脑端上报的值只在云端为空时写入（`COALESCE(NULLIF(...))`）。
- R2（绑定名 `IMAGES`）是可选的：开通 R2 要绑卡，开源用户多半没有。没绑时 `status.get` 返回 `images: false`，前端隐藏发图按钮，上传和带图发送直接报错，工具截图换成一句文字说明，提示词里也会告诉模型看不到图；历史里取不到的图片在发给模型时换成 `[图片不可用]`，不让整次请求失败。
- D1 是整个部署共用的（一个部署 = 一个用户），不按设备隔离。
- 界面：右上角宫格是应用中心（助理 / 终端 / 文件 / 状态 / 屏幕 / 设置），默认进助理；左上角汉堡菜单随应用变化（助理=对话列表，终端=终端列表）；顶栏设备选择器。

## 命令

各子项目自己的 `package.json` 为准：

- `worker/`：Vite + Wrangler，开发用 `npm run dev`，部署 `npm run deploy`（按用户偏好直接 deploy）。
- 本地联调：`npx wrangler d1 execute roam --local --file=server/agent/schema.sql` 建表后 `npx wrangler dev --port 9507 --var SETTINGS_KEY:dev --var DEVICE_TOKEN:e2e-token --var ACCESS_PASSWORD:e2e-pass`，再 `node tests/e2e.mjs`（假模型 + 两台假设备：鉴权、设备描述、会话默认设备、工具按 device 路由、不存在 / 离线失败、断开只 drain 自己、终端消息路由、同 id 重连）和 `node tests/extra.mjs`（运行中停止、多网页共存、密码锁定——会把本地 hub 锁 30 分钟，放最后；要重跑就删 `.wrangler/state/v3/do` 重启 dev）。测试脚本里写的端口是 9507。`wrangler d1 execute` 在本机偶尔执行完不退出，加 `CI=1` 或直接杀掉即可。
- 把本机电脑端接到本地 dev：`CLOUDFLARE_WORKER_URL=http://127.0.0.1:9507 DEVICE_TOKEN=e2e-token node computer/index.js`（环境变量覆盖 config.js）。
- `computer/`：看 `computer/package.json` 入口。

## 注意

- 部署 Worker 前确认 `wrangler.jsonc` 的 `account_id` 是要部署的账号；D1 `roam`、R2 `roam` 已建，表已建（`schema.sql` 全是 `IF NOT EXISTS`，改了结构再跑一遍；`v_devices` 视图会先 DROP 再建）。
- Worker secret：`SETTINGS_KEY`（加密 API Key，改了之前存的 Key 就解不开）、`DEVICE_TOKEN`（所有电脑端 `config.js` 里是同一个值）、`ACCESS_PASSWORD`（网页访问密码）。
- 不提交 `node_modules`、`.wrangler`、本地配置和凭据。

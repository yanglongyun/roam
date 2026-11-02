# roam

在手机上继续使用电脑里的 Claude Code / Codex。电脑端主动连 Cloudflare Worker（带 `DEVICE_TOKEN`）；网页只连 Worker。终端 / 文件 / 屏幕只经 Worker 中继；助理（模型调用、会话、消息、图片）跑在 Worker 的 Durable Object 里，电脑端只负责执行 shell / 文件 / 浏览器这些工具。

- origin: `https://github.com/yanglongyun/roam.git`

## 结构

- `worker/`：Cloudflare Worker + Vue 前端；Durable Object `TerminalSessionManager`（每个 `session` 一个），承载 WebSocket、终端和助理。
- `worker/server/agent/`：助理本体，跑在 DO 里：`api.js` 的 `callOp` 是网页用的 op 表（电脑端不调它，只发 `device.report` 和 `tool.result`），`runner.js` + `loop.js` 跑 Responses 接口和工具循环，`rpc.js` 是设备工具桥（`tool.call` / `tool.result`），数据在 D1 + R2（`schema.sql`）。
- `computer/`：电脑端，提供终端 / 文件 / 屏幕，执行助理的工具调用；配置在 `config.js`（或 `.env` / 环境变量），必填 `CLOUDFLARE_WORKER_URL` 和 `DEVICE_TOKEN`。
- `computer/services/agent/`：电脑端只剩工具执行（`agent/functions/*`）和浏览器桥，不再有数据库和模型调用。
- `computer/services/agent/browser/`：对应 agentic launcher 的浏览器桥、原生消息宿主和宿主登记；宿主名 `yun.roam.browser`。
- `extension/`：Roam 浏览器插件（取自 agentic 插件），manifest 里的 key 决定固定 ID `opkcnndhnmkilimegkcgeecanhjebpge`，要和 `register-host.js` 一致。权限按最高能力给：`debugger` + `<all_urls>` + 所有标签页，`chrome` 动作开放 tabs / windows / tabGroups / downloads / cookies / history / bookmarks / sessions / topSites 这几个命名空间；browsingData、management、proxy 这类改浏览器本身的故意不开。浏览器工具的执行在 `computer/services/agent/agent/functions/browser.js`，给模型的说明在 `worker/server/agent/tools.js`，三处要一起改。

## 链路

```
远程浏览器 ──wss──> Cloudflare Worker（DO：终端中继 + 助理 + D1/R2） ──wss + DEVICE_TOKEN──> Roam Computer（终端 / 文件 / 屏幕 + 执行工具）
```

## 能力

- 远程终端、AI 助理（电脑端执行 shell / read / write / edit / browser，云端执行 sql；Responses 接口，重试、上下文压缩）、文件浏览/读取/上传/重命名/删除、屏幕截图、固定 session id。
- 网页发 `agent.request {reqId, op, args}`，回 `agent.result`；助理事件经 `agent.event` 推送（`session_id` + 事件字段平铺，事件类型 `message` / `reasoning`（带 `delta` 是流式片段，带 `item` 是完整一项）/ `function_call` / `function_call_output` / `usage` / `compact`（`status` 为 started / completed）/ `retry` / `error` / `done`）。
- API Key 用 `SETTINGS_KEY` 加密后存 D1，只在 DO 里解密使用；模型请求从 Worker 发出，电脑端只收 `tool.call`。
- 电脑端接入要带 `Authorization: Bearer <DEVICE_TOKEN>`，Worker 在转给 DO 之前校验，不对就 401。电脑端能免密码、能放行网页，D1 又是全局的，这道校验不能去掉。
- R2（绑定名 `IMAGES`）是可选的：开通 R2 要绑卡，开源用户多半没有。没绑时 `status.get` 返回 `images: false`，前端隐藏发图按钮，上传和带图发送直接报错，工具截图换成一句文字说明，提示词里也会告诉模型看不到图；历史里取不到的图片在发给模型时换成 `[图片不可用]`，不让整次请求失败。
- D1 是整个部署共用的（一个部署 = 一个用户），不按 session 隔离。所以电脑端接入时 DO 把自己的 session 名写进 D1 的 `active` 表，网页的 `agent.request` 只在本 DO 就是当前 session 时放行；旧 session 的链接和免密令牌一律拒绝（DO 的 session 名从连接 URL 取，存在 DO storage 里）。
- 电脑端 `auth.mode` 带密码指纹 `fingerprint`（HMAC，不是密码本身）；DO 发现指纹变了就清掉所有免密令牌、把已登录网页打回未认证。
- 界面：右上角宫格是应用中心（助理 / 终端 / 文件 / 状态 / 屏幕 / 设置），默认进助理；左上角汉堡菜单随应用变化（助理=对话列表，终端=终端列表）。

## 命令

各子项目自己的 `package.json` 为准：

- `worker/`：Vite + Wrangler，开发用 `npm run dev`，部署 `npm run deploy`（按用户偏好直接 deploy）。
- 本地联调：`npx wrangler d1 execute roam --local --file=server/agent/schema.sql` 建表后 `npx wrangler dev --port 9507 --var SETTINGS_KEY:<随便> --var DEVICE_TOKEN:e2e-token`（测试脚本默认用 `e2e-token`，可用环境变量 `DEVICE_TOKEN` 覆盖），再 `node tests/e2e.mjs`（假模型 + 假设备，跑配置/会话/发消息/工具往返/图片/离线/停止）和 `node tests/extra.mjs`（密码拦截、运行中停止）。测试脚本里写的端口是 9507。
- `computer/`：看 `computer/package.json` 入口。

## 注意

- 部署 Worker 前确认 `wrangler.jsonc` 的 `account_id` 是要部署的账号；D1 `roam`、R2 `roam` 已建，表已建（`schema.sql` 全是 `IF NOT EXISTS`，改了结构再跑一遍）。
- Worker secret：`SETTINGS_KEY`（加密 API Key，改了之前存的 Key 就解不开）、`DEVICE_TOKEN`（本机 `computer/config.js` 里是同一个值）。
- 不提交 `node_modules`、`.wrangler`、本地配置和凭据。

# roam

在手机上继续使用电脑里的 Claude Code / Codex。电脑端主动连 Cloudflare Worker，Worker 只做中继，远程网页只连 Worker，数据不落地。

- origin: `https://github.com/yanglongyun/roam.git`

## 结构

- `worker/`：Cloudflare Worker + Vue 前端 + WebSocket 中继；Durable Object `TerminalSessionManager`。
- `computer/`：电脑端，提供终端 / 文件 / 屏幕 / AI 助理能力。
- `computer/services/agent/`：助理，取自 agentic（`../agentic/app/server`）。`agent/`、`ai/` 原样同步 agentic；`ops/` 是聊天层，对应 agentic 的 `api/sessions` 等接口，改走 WS：网页发 `agent.request {reqId, op, args}`，回 `agent.result`；Agent 九种事件经 `agent.event` 推送。数据在 `~/.roam/agent/`（config.json / chat.db / images/）。
- `computer/services/agent/browser/`：对应 agentic launcher 的浏览器桥、原生消息宿主和宿主登记；宿主名 `yun.roam.browser`。
- `extension/`：Roam 浏览器插件（取自 agentic 插件），manifest 里的 key 决定固定 ID `opkcnndhnmkilimegkcgeecanhjebpge`，要和 `register-host.js` 一致。

## 链路

```
远程浏览器 ──https/wss──> Cloudflare Worker（中继，不存数据） ──wss──> Roam Computer
```

## 能力

- 远程终端、AI 助理（shell / read / write / edit / browser 工具，Responses 接口，重试、上下文压缩）、文件浏览/读取/上传/重命名/删除、屏幕截图、固定 session id。
- 模型请求从电脑端直接发出，Worker 只中继 `agent.*` 消息，不存对话也不碰 API Key。
- 界面：右上角宫格是应用中心（助理 / 终端 / 文件 / 状态 / 屏幕 / 设置），默认进助理；左上角汉堡菜单随应用变化（助理=对话列表，终端=终端列表）。

## 命令

各子项目自己的 `package.json` 为准：

- `worker/`：Vite + Wrangler，开发用 `npm run dev`，部署 `npm run deploy`（按用户偏好直接 deploy）。
- `computer/`：看 `computer/package.json` 入口。

## 注意

- 部署 Worker 前 `npx wrangler whoami` 确认账号。
- 不提交 `node_modules`、`.wrangler`、本地配置和凭据。

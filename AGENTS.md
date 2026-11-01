# roam

在手机上继续使用电脑里的 Claude Code / Codex。电脑端主动连 Cloudflare Worker，Worker 只做中继，远程网页只连 Worker，数据不落地。

- origin: `https://github.com/yanglongyun/roam.git`

## 结构

- `worker/`：Cloudflare Worker + Vue 前端 + WebSocket 中继；Durable Object `TerminalSessionManager`。
- `computer/`：电脑端，提供终端 / 文件 / 屏幕 / AI 对话能力。agent 在 `computer/services/chat/`，数据在 `~/.roam/roam.db`（`node:sqlite`）。
- `extension/`：browser-use Chrome 扩展，连电脑端本地 CDP 桥（127.0.0.1:9510），供 agent 的 `browser_cdp` 工具驱动 Chrome。

## 链路

```
远程浏览器 ──https/wss──> Cloudflare Worker（中继，不存数据） ──wss──> Roam Computer
```

## 能力

- 远程终端、AI 对话（shell / 键鼠截图 / 浏览器 CDP 工具，上下文自动压缩）、文件浏览/读取/上传/重命名/删除、屏幕截图、固定 session id。
- 模型请求从电脑端直接发出，Worker 只中继 `ai.*` / `model.*` 消息，不存对话也不碰 API Key。

## 命令

各子项目自己的 `package.json` 为准：

- `worker/`：Vite + Wrangler，开发用 `npm run dev`，部署 `npm run deploy`（按用户偏好直接 deploy）。
- `computer/`：看 `computer/package.json` 入口。

## 注意

- 部署 Worker 前 `npx wrangler whoami` 确认账号。
- 不提交 `node_modules`、`.wrangler`、本地配置和凭据。

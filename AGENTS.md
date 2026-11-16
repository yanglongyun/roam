# roam

在手机上继续使用电脑里的 Claude Code / Codex。本机 Server 主动连 Cloudflare Worker，Worker 只做中继，远程网页只连 Worker，数据不落地。

- origin: `https://github.com/yanglongyun/roam.git`

## 结构

- `worker/`：Cloudflare Worker + Vue 前端 + WebSocket 中继；Durable Object `TerminalSessionManager`。
- `server/`：本机 Server，提供终端 / 文件 / 屏幕能力。

## 链路

```
远程浏览器 ──https/wss──> Cloudflare Worker（中继，不存数据） ──wss──> 本机 Roam Server
```

## 能力

- 远程终端、文件浏览/读取/上传/重命名/删除、屏幕截图、固定 session id。

## 命令

各子项目自己的 `package.json` 为准：

- `worker/`：Vite + Cloudflare Vite 插件 + `cf` CLI，开发用 `npm run dev`（`cf dev`），部署 `npm run deploy`（`cf deploy`，按用户偏好直接 deploy）。配置在 `cloudflare.config.ts`（gitignore，模板 `cloudflare.config.example.ts`）；无状态中继，不需要 D1 / R2 / secret。
- `server/`：看 `server/package.json` 入口。

## 注意

- 部署 Worker 前 `npx cf auth whoami` 确认账号。
- 不提交 `node_modules`、`.wrangler`、本地配置和凭据。

# Meem

把本机能力通过浏览器带到任意设备上。

Meem 不是把你的机器暴露到公网，而是让本机 Client 主动连到 Cloudflare Worker。远程网页只连 Worker，Worker 负责中继；终端、文件、屏幕、浏览器和 Agent 执行都发生在你的本机。

## 项目组成

```text
meem/
├─ worker/               # Cloudflare Worker + Vue 前端 + WebSocket 中继
├─ client/               # 本机 Client，提供终端、文件、屏幕、Agent、浏览器 bridge
└─ browser/
   ├─ extension/         # Chrome 扩展，连接本机浏览器 bridge
   └─ skill/             # 给 Agent 使用浏览器插件的 SKILL.md
```

运行时链路：

```text
远程浏览器
  ↓ https / wss
Cloudflare Worker
  ↓ wss
本机 Meem Client
  ├─ terminal / files / screen
  ├─ agents / llm
  └─ browser bridge ← Chrome extension ← 当前浏览器标签页
```

## 能力

- 远程终端
- 文件浏览、读取、上传、重命名、删除
- 屏幕截图查看
- 多会话 Agent
- 子 Agent 消息追踪
- 当前浏览器控制，复用当前标签页和登录态
- Playwright 独立浏览器自动化
- 本地 SQLite 持久化
- 固定远程连接 session id

本地数据库默认位置：

- macOS / Linux / WSL：`~/.meem/meem.db`
- Windows：`C:\Users\<用户名>\.meem\meem.db`

## Client 架构

```text
client/
├─ agents/   # 多 Agent 运行时、工具编排、浏览器/Playwright 子 Agent
├─ apps/     # terminal / files / screen / guard 等具体能力
├─ core/     # 配置、ID、MIME 等共享基础模块
├─ llm/      # provider catalog、请求器、输入输出适配
├─ server/   # WebSocket、消息路由、本地浏览器 bridge
├─ db.js     # SQLite 初始化和持久化接口
└─ index.js  # Client 启动入口
```

内置 Agent：

- `main`：主控 Agent，理解任务并选择终端、浏览器或子 Agent。
- `browser`：控制用户当前浏览器，由 Chrome 扩展和本地 bridge 提供能力。
- `playwright`：启动独立自动化浏览器，适合隔离、可重复的网页流程。

## 浏览器能力

Meem 有两条浏览器路径。

当前浏览器路径：

- 源码在 `browser/extension/` 和 `client/server/browser/`
- 复用用户当前浏览器、当前标签页、当前登录态
- 适合已登录网站、运营后台、当前页面读取和轻量控制

Playwright 路径：

- 源码在 `client/agents/playwright/`
- 由 Client 在本机启动独立受控浏览器
- 适合隔离执行、稳定自动化、不会影响当前浏览器页面

Agent 侧的使用说明在 `browser/skill/SKILL.md`。

## LLM Provider

Provider catalog 只维护在 `client/llm/providers.js`。

前端 Agent 设置页会从 Client 动态接收：

- provider groups
- provider list
- 默认 API URL
- 默认 model
- key 获取入口

因此新增或修改 provider 时，不需要在 worker 前端再同步一份常量。

## 前置要求

- Node.js 20+
- Cloudflare 账号
- 一台运行 Meem Client 的本机电脑
- Chrome 或 Chromium 系浏览器
- 如果在 Windows 上安装原生依赖，可能需要 Visual Studio Build Tools 2022 和 Desktop development with C++

## 部署 Worker

```bash
git clone https://github.com/valueriver/meem
cd meem/worker
npm install
cp wrangler.example.jsonc wrangler.jsonc
```

编辑 `worker/wrangler.jsonc`：

- `account_id`：Cloudflare account id，可用 `npx wrangler whoami` 查看
- `routes`：可选，自定义域名；不用自定义域名就删除整个 `routes` 段

部署：

```bash
npm run deploy
```

部署完成后得到 Worker 地址，例如：

- `https://meem.<your-subdomain>.workers.dev`
- `https://i.example.com`

## 配置 Client

```bash
cd ../client
npm install
cp config.example.js config.js
```

编辑 `client/config.js`：

```js
export default {
    CLOUDFLARE_WORKER_URL: 'https://meem.example.workers.dev', // 已部署的 Cloudflare Worker 地址，可用 workers.dev 或自定义域名；旧 MEEM_URL 仍兼容
    SESSION_ID: '', // 固定连接会话 ID；留空则每次启动随机生成，不能写 default
    SESSION_PASSWORD: '', // 远程网页访问密码；留空则不需要登录校验
    PLAYWRIGHT_BROWSER_CHANNEL: 'chrome', // Playwright 独立浏览器通道，常用值 chrome / msedge / chromium；旧 BROWSER_CHANNEL 仍兼容
    BROWSER_EXTENSION_HOST: '127.0.0.1', // 本地浏览器扩展 bridge 监听地址，通常不用改；旧 CHROME_EXTENSION_HOST 仍兼容
    BROWSER_EXTENSION_PORT: '17373', // 本地浏览器扩展 bridge 监听端口，需和扩展弹窗里的端口一致；旧 CHROME_EXTENSION_PORT 仍兼容
    DEBUG: '0', // 调试日志开关；写 1 会打印 WebSocket 收包摘要；旧 MEEM_DEBUG 仍兼容
};
```

配置来源优先级：

1. 环境变量
2. `client/.env`
3. `client/config.js`

`SESSION_ID` 用于固定远程入口。留空时每次 Client 启动都会随机生成新 session；填固定值后，每次启动都使用同一个访问链接。`SESSION_ID` 不能写 `default`。

## 启动 Client

```bash
cd client
npm start
```

启动后控制台会输出：

- 远程访问入口
- 访问密码，如果配置了 `SESSION_PASSWORD`
- 本地浏览器扩展 bridge 地址

如果你希望电脑休眠时也尽量保持运行，macOS 可以这样启动：

```bash
caffeinate -dimsu node /path/to/meem/client/index.js
```

## 加载 Chrome 扩展

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 点击 `Load unpacked`
4. 选择 `meem/browser/extension`
5. 打开扩展弹窗，确认本地地址和端口与 `client/config.js` 一致
6. 点击建立连接

扩展连接后，Agent 可以通过 `browser` 子 Agent 使用当前浏览器标签页。

## 配置 Agent 模型

打开远程访问入口，进入 Agent 页面，点击右上角设置。

需要配置：

- Provider
- API URL
- API Key
- Model

配置会保存到本机 `~/.meem/meem.db`，不是保存在 Worker。

## 常用命令

Worker：

```bash
cd worker
npm run build
npm run deploy
```

Client：

```bash
cd client
npm start
```

语法检查示例：

```bash
node --check client/core/env.js
node --check client/server/ws.js
```

## 排障

访问页面显示未连接：

- 确认 `client` 正在运行
- 确认 `CLOUDFLARE_WORKER_URL` 是当前部署的 Worker 地址
- 确认远程 URL 里的 `session` 和 Client 控制台打印的一致
- 如果使用固定 session，确认 `SESSION_ID` 没有写错

扩展显示未连接：

- 确认 Client 正在运行
- 确认扩展里的 host / port 与 `BROWSER_EXTENSION_HOST` / `BROWSER_EXTENSION_PORT` 一致
- 确认 Chrome 已加载 `browser/extension`

Agent 提示未配置：

- 到 Agent 设置里填写 Provider、API URL、API Key、Model
- 如果只改了 `client/llm/providers.js`，需要重启 Client 才会下发新的 provider catalog

Client 启动失败：

- 先确认 `client/config.js` 是 ESM 格式：`export default { ... }`
- 确认 `CLOUDFLARE_WORKER_URL` 是完整 URL，例如 `https://i.example.com`
- Windows 原生依赖安装失败时，安装 Visual Studio Build Tools 2022

## 安全边界

- Worker 不保存终端输出、文件内容、模型 Key 或 Agent 历史
- 真实数据保存在本机 Client 和本机 SQLite
- `SESSION_PASSWORD` 用于远程网页访问校验
- 不要把真实 `client/config.js` 和 `worker/wrangler.jsonc` 提交到仓库

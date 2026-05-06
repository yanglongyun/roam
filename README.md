<div align="center">

```text
      .                路               .
                          _
                        _/ \_
              _       _/     \_
            _/ \_    /         \_
          _/     \__/             \___
        _/                             \__
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

# Meem 路漫游

忘掉 SSH，忘掉 VPN，忘掉端口转发。

终端、文件、屏幕、Agent、浏览器，直接在任意设备的浏览器里连回你自己的电脑。

</div>

---

## 这是什么

Meem 把你的电脑能力通过 Cloudflare Worker 中继到浏览器端。

- 浏览器端负责 UI 和交互
- `worker/` 负责中继、认证状态和 WebSocket 转发
- `client/` 运行在你的电脑上，负责终端、文件、截图、Agent 和浏览器能力

---

## 特性

- 完整终端：多标签、xterm、触屏友好
- 文件管理：浏览、预览、上传、下载、重命名
- 屏幕查看：按需抓取当前桌面截图，只读
- AI Agent：支持 OpenAI 兼容接口，可调用本机工具
- 浏览器控制：Agent 可通过 Playwright 操作本机浏览器
- 本地持久化：SQLite 保存在 `~/.meem/meem.db`
- 链接即会话：浏览器打开链接即可进入你的机器

## 技术栈

Cloudflare Workers, Durable Objects, WebSocket Hibernation, Vue 3, Vite, Tailwind 4, xterm, Pinia, Node.js, better-sqlite3, node-pty, Playwright

---

## 部署

需要：

- Cloudflare 账号
- Node 20+
- 一台常开的电脑（macOS / Linux / Windows / WSL）

### 1. 部署 Worker

```bash
git clone https://github.com/valueriver/meem
cd meem/worker
npm install

cp wrangler.example.jsonc wrangler.jsonc
# 填写 account_id；如需绑定域名，再配置 routes

npm run deploy
```

部署后会得到一个 `https://...workers.dev` 或自定义域名地址。

### 2. 启动本机 Client

```bash
cd ../client
npm install
cp config.example.js config.js
```

你可以二选一：

1. 复制并编辑 `client/config.js`
2. 或使用 `.env` / 环境变量

`config.js` 方式：

```js
module.exports = {
  MEEM_URL: 'https://meem.example.workers.dev',
  SESSION_PASSWORD: '',
  BROWSER_CHANNEL: 'chrome',
  MEEM_DEBUG: '0',
};
```

启动：

```bash
npm start
```

`.env` 方式：

```bash
cp .env.example .env
```

然后填写：

```env
MEEM_URL=https://meem.example.workers.dev
SESSION_PASSWORD=
BROWSER_CHANNEL=chrome
MEEM_DEBUG=0
```

也可以直接使用环境变量启动：

```bash
MEEM_URL=https://meem.example.workers.dev npm start
```

优先级：

1. 环境变量
2. `.env`
3. `config.js`

控制台会打印访问链接。浏览器打开即可连接。

### 3. 配置 Agent

首次进入 `/agent` 页面后，填写：

- `API URL`
- `API Key`
- `Model`

这些配置会持久化到 `~/.meem/meem.db`。

### 4. 常用页面

- `/terminal`：远程终端
- `/files`：文件浏览和传输
- `/screen`：桌面截图查看
- `/agent`：AI Agent

---

## 安全模型

- 密码采用 challenge/response
- 会话 token 本地缓存
- 可限制单设备独占
- `/screen` 只返回截图，不提供远程点击和键盘输入

---

## 项目结构

```text
meem/
├── worker/         # Cloudflare Worker: 中继 + SPA
│   ├── server/     # Durable Object / WebSocket
│   └── src/        # 前端(Vue 3 + Pinia + xterm)
└── client/         # 本机 Client: auth / pty / fs / screen / agent
    ├── guard/
    ├── terminal/
    ├── files/
    ├── screen/
    └── agent/
```

---

## 本地开发

Worker / 前端：

```bash
cd worker
npm install
npm run dev:web
npm run build
npm run deploy
```

Client：

```bash
cd client
npm install
cp config.example.js config.js
npm start
```

快速检查：

```bash
cd worker && npm run build
cd ../client && node -e "require('./screen'); require('./core/router')"
```

---

## License

[MIT](./LICENSE)

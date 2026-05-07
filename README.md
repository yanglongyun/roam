# Roam

**纯远程访问场景** —— 把本机的终端 / 文件 / 屏幕带到任意设备的浏览器上。

机器不暴露公网。本机 Client 主动连 Cloudflare Worker,Worker 只做中继。远程网页只连 Worker,数据不落地。

> 这个仓库的前身是 [valueriver/meem](https://github.com/valueriver/meem)。后来把 Agent / LLM 那块拆掉,只保留"远程访问"内核,改名为 Roam。需要 Agent / 文档 / Todo 等本机能力,请用新的 [meem](https://github.com/valueriver/meem)(纯本机版,不用 Worker)。

## 项目组成

```text
roam/
├─ worker/               # Cloudflare Worker + Vue 前端 + WebSocket 中继
├─ client/               # 本机 Client,提供终端 / 文件 / 屏幕 / 浏览器 bridge
└─ browser/
   ├─ extension/         # Chrome 扩展,连接本机浏览器 bridge
   └─ skill/             # 给外部 AI / 脚本使用浏览器插件的 SKILL.md
```

运行时链路:

```text
远程浏览器
  ↓ https / wss
Cloudflare Worker (中继,不存数据)
  ↓ wss
本机 Roam Client
  ├─ terminal / files / screen
  └─ browser bridge ← Chrome extension ← 当前浏览器标签页
```

## 能力

- 远程终端
- 文件浏览、读取、上传、重命名、删除
- 屏幕截图查看
- 当前浏览器控制(复用当前标签页和登录态)
- 固定远程连接 session id

## 前置要求

- Node.js 20+
- Cloudflare 账号
- 一台运行 Roam Client 的本机电脑
- Chrome 或 Chromium 系浏览器

## 部署 Worker

```bash
git clone https://github.com/valueriver/roam
cd roam/worker
npm install
cp wrangler.example.jsonc wrangler.jsonc
```

编辑 `worker/wrangler.jsonc`:

- `account_id`:Cloudflare account id,可用 `npx wrangler whoami` 查看
- `routes`:可选,自定义域名;不用就删掉整个 `routes` 段

部署:

```bash
npm run deploy
```

部署完成后得到 Worker 地址,例如:

- `https://roam.<your-subdomain>.workers.dev`
- `https://i.example.com`

## 配置 Client

```bash
cd ../client
npm install
cp config.example.js config.js
```

编辑 `client/config.js`:

```js
export default {
    CLOUDFLARE_WORKER_URL: 'https://roam.example.workers.dev', // 上面部署得到的 Worker 地址
    SESSION_ID: '',          // 固定 session id,留空则每次启动随机
    SESSION_PASSWORD: '',    // 远程访问密码,留空则不要密码
    PLAYWRIGHT_BROWSER_CHANNEL: 'chrome',
    BROWSER_EXTENSION_HOST: '127.0.0.1',
    BROWSER_EXTENSION_PORT: '17373',
    DEBUG: '0',
};
```

## 启动 Client

```bash
cd client
npm start
```

启动后控制台会输出:

- 远程访问入口(URL)
- 访问密码(如果配置了)
- 本地浏览器扩展 bridge 地址

如果希望电脑休眠时也尽量保持运行,macOS 可以这样启动:

```bash
caffeinate -dimsu node /path/to/roam/client/index.js
```

## 加载 Chrome 扩展

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 点击 `Load unpacked`
4. 选择 `roam/browser/extension`
5. 打开扩展弹窗,确认本地地址和端口与 `client/config.js` 一致
6. 点击建立连接

## 排障

页面显示未连接:

- 确认 `client` 正在运行
- 确认 `CLOUDFLARE_WORKER_URL` 是当前部署的 Worker 地址
- 确认远程 URL 里的 `session` 和 Client 控制台打印的一致

扩展显示未连接:

- 确认 Client 正在运行
- 确认扩展里的 host / port 与 `BROWSER_EXTENSION_HOST` / `BROWSER_EXTENSION_PORT` 一致

## 安全边界

- Worker 不保存终端输出、文件内容或任何业务数据
- 真实数据保留在本机 Client
- `SESSION_PASSWORD` 用于远程网页访问校验
- 不要把真实 `client/config.js` 和 `worker/wrangler.jsonc` 提交到仓库

## License

MIT

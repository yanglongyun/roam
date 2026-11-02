# Roam

**在手机上继续使用电脑里的 Claude Code / Codex** —— 把电脑端的终端 / 文件 / 屏幕带到任意设备的浏览器上,再加一个跑在云端、能操作你电脑的 AI 助理。

机器不暴露公网。电脑端主动连 Cloudflare Worker,远程网页也只连 Worker。终端、文件、屏幕的数据只经 Worker 中继,不落地;助理的对话和配置存在你自己 Cloudflare 账号的 D1 里。全部用免费额度,不用绑卡。

| 终端 | 文件管理 | 系统状态 |
|---|---|---|
| ![终端](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/01-terminal.png) | ![文件管理](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/02-files.png) | ![系统状态](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/03-status.png) |

社区讨论: [LINUX DO](https://linux.do)

> **顺便打个广告**:我目前主力在做的另一个项目是 [AIOS](https://github.com/valueriver/AIOS) —— 用 AI 直接构建一个操作系统,欢迎去看看、Star、提 issue。

## 项目组成

```text
roam/
├─ worker/               # Cloudflare Worker + Vue 前端;Durable Object 负责中继和 AI 助理
├─ computer/             # 电脑端,提供终端 / 文件 / 屏幕,并执行助理的工具调用
└─ extension/            # Roam 浏览器插件,让助理操作本机 Chrome / Edge
```

运行时链路:

```text
远程浏览器
  ↓ https / wss
Cloudflare Worker(终端/文件/屏幕只中继;助理跑在这里,对话存 D1,图片存 R2(可选))
  ↓ wss(带 DEVICE_TOKEN)
Roam Computer(终端 / 文件 / 屏幕 / 执行助理的工具)
```

## 能力

- 远程终端
- AI 助理(agent,来自 agentic):模型调用和对话在云端,电脑关机也能翻看历史;要动电脑时把工具调用发给电脑端执行,可执行命令、读写和修改文件、看图、操作浏览器
- 文件浏览、读取、上传、重命名、删除
- 屏幕截图查看
- 固定远程连接 session id

## 前置要求

- Node.js 22+
- Cloudflare 账号,免费计划就行(用到 Workers、Durable Objects、D1;想让助理收发图片再开 R2,开通 R2 要绑卡)
- 一台运行 Roam Computer 的电脑

## 部署 Worker

```bash
git clone https://github.com/yanglongyun/roam
cd roam/worker
npm install
cp wrangler.example.jsonc wrangler.jsonc
```

建好助理要用的数据库:

```bash
npx wrangler d1 create roam
```

编辑 `worker/wrangler.jsonc`:

- `account_id`:Cloudflare account id,可用 `npx wrangler whoami` 查看
- `d1_databases[0].database_id`:上一步 `d1 create` 打印的 id
- `routes`:可选,自定义域名;不用就删掉整个 `routes` 段

建表、设两个密钥(都用随机串,比如 `openssl rand -base64 32` 生成):

```bash
npx wrangler d1 execute roam --remote --file=server/agent/schema.sql
npx wrangler secret put SETTINGS_KEY   # 加密保存模型 API Key 用,设了别再改
npx wrangler secret put DEVICE_TOKEN   # 电脑端接入凭据,下面 config.js 填同一个值
```

部署:

```bash
npm run deploy
```

部署完成后得到 Worker 地址,例如:

- `https://roam.<your-subdomain>.workers.dev`
- `https://i.example.com`

### 可选:开启图片(R2)

不开 R2 时,助理只能收发文字:网页上不显示发图按钮,`read` 读图片、`browser` 截图也看不到图片内容(浏览器工具改用读网页文字和元素位置)。

要开的话,先在 Cloudflare 控制台开通 R2(需要绑卡,免费额度每月 10 GB),然后:

```bash
npx wrangler r2 bucket create roam
```

把 `worker/wrangler.jsonc` 里 `r2_buckets` 段的注释去掉,再 `npm run deploy`。

## 配置 Computer

```bash
cd ../computer
npm install
cp config.example.js config.js
```

编辑 `computer/config.js`:

```js
export default {
    CLOUDFLARE_WORKER_URL: 'https://roam.example.workers.dev',
    DEVICE_TOKEN: '',        // 和 Worker 的 DEVICE_TOKEN secret 一致
    SESSION_ID: '',          // 留空则每次启动随机生成
    SESSION_PASSWORD: '',    // 留空则不要密码
    DEBUG: '0',
};
```

也可以用环境变量或 `computer/.env`(见 `.env.example`)。`DEVICE_TOKEN` 不对时 Worker 会拒绝连接,控制台会提示。

## 启动 Computer

```bash
cd computer
npm start
```

控制台会输出:

- 远程访问入口 URL
- 访问密码(如果配置了)

## AI 助理

右上角宫格(应用中心)里的「助理」是内置的 agent,也是登录后的默认页;左上角菜单里是对话历史(置顶、拖拽排序、重命名、删除)和新建对话。agent 取自 [agentic](https://github.com/yanglongyun/agentic),跑在 Worker 的 Durable Object 里:模型请求从 Worker 发出,需要动电脑时把工具调用经 WebSocket 发给电脑端执行,结果再送回云端。

1. 打开「设置」,填 Responses 接口地址(如 `https://api.openai.com/v1/responses`)、API Key、模型并保存
2. 回到「助理」直接说要做什么,可以附带图片(每条最多 5 张)

会话、消息、设置和设备登记存在 D1,图片存在 R2(没开 R2 就不收发图片);API Key 用 `SETTINGS_KEY` 加密后入库,网页端只能看到掩码。电脑端本机只留浏览器插件的管道和工具截图的临时目录(`~/.roam/agent/`)。

agent 可用的工具:

| 工具 | 在哪执行 | 说明 |
|---|---|---|
| `shell` | 电脑端 | 执行终端命令(macOS / Linux 用 bash,Windows 用 PowerShell),超时会杀掉整个进程组 |
| `read` | 电脑端 | 带行号读文本;PNG / JPEG / GIF / WebP 图片直接交给模型看 |
| `write` | 电脑端 | 写入完整文件,自动创建父目录 |
| `edit` | 电脑端 | 精确替换文本,默认要求唯一匹配 |
| `browser` | 电脑端 | 操作 Chrome / Edge:只能操作自己打开的标签页,每个对话一个标签组;页面里的操作用 CDP,截图会交给模型看 |
| `sql` | 云端 | 查询和修改助理自己的 D1 数据(会话、消息、设置等);电脑端离线时只有它能用 |

电脑端离线时,对话照常能看、能发,这一轮模型只拿到 `sql` 工具,会如实告诉你需要先连上电脑。模型请求失败(网络、429、5xx、断流)会自动重试两次。上次回复用掉的 token 达到「压缩阈值」时,会把较早的消息写成交接摘要,保留最近的若干条;阈值、保留条数、提示词、超时和输出上限都能在设置里改。

### 浏览器插件

1. Chrome / Edge 打开扩展程序页 → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `extension/`
2. 不用填任何地址:插件经原生消息连上电脑端(电脑端启动时会把宿主登记到本机已安装的 Chromium 系浏览器,目前支持 macOS 和 Windows)
3. 插件图标显示 `on` 后,助理就能用 `browser` 工具操作你已登录的浏览器

插件和电脑端之间走只有当前用户能连的本机管道(`~/.roam/agent/browser.sock`),不开端口。

## 保活运行

希望关机/重启/网络抖动后 computer 自动起来,各平台推荐做法:

### macOS

**临时(终端开着才活,关电脑前阻止休眠):**

```bash
caffeinate -dimsu node /path/to/roam/computer/index.js
```

**长期(开机自启,崩了自动拉起):** 用 launchd。新建 `~/Library/LaunchAgents/me.meeem.roam.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>me.meeem.roam</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/YOU/path/to/roam/computer/index.js</string>
    </array>
    <key>WorkingDirectory</key><string>/Users/YOU/path/to/roam/computer</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/tmp/roam.out.log</string>
    <key>StandardErrorPath</key><string>/tmp/roam.err.log</string>
</dict>
</plist>
```

加载:

```bash
launchctl load ~/Library/LaunchAgents/me.meeem.roam.plist
launchctl unload ~/Library/LaunchAgents/me.meeem.roam.plist  # 卸载
```

`which node` 看下你的 node 路径,nvm 装的话写 nvm 实际路径。Roam 在 macOS / Linux
上会以登录 shell 启动远程终端,从而加载用户平时使用的 PATH;这也能让 Homebrew、
Codex 等命令在 `launchd` 启动的 Roam 中保持可用。

### Linux

用 systemd user service。新建 `~/.config/systemd/user/roam.service`:

```ini
[Unit]
Description=Roam Computer
After=network-online.target

[Service]
ExecStart=/usr/bin/node /home/YOU/roam/computer/index.js
WorkingDirectory=/home/YOU/roam/computer
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

启用 + 启动:

```bash
systemctl --user daemon-reload
systemctl --user enable --now roam
systemctl --user status roam
journalctl --user -u roam -f          # 看日志
```

如果希望未登录也跑(headless 服务器):`sudo loginctl enable-linger $USER`。

### Windows

最省事用 [nssm](https://nssm.cc/) 把 node 注册成 Windows 服务:

```powershell
nssm install Roam "C:\Program Files\nodejs\node.exe" "C:\path\to\roam\computer\index.js"
nssm set Roam AppDirectory "C:\path\to\roam\computer"
nssm start Roam
nssm remove Roam confirm   # 卸载
```

或用任务计划程序触发器选"启动时",操作填 `node.exe` + 脚本路径。

## 排障

页面显示未连接:

- 确认 `computer` 正在运行
- 确认 `CLOUDFLARE_WORKER_URL` 是当前部署的 Worker 地址
- 确认远程 URL 里的 `session` 和 Computer 控制台打印的一致
- Computer 控制台出现 `401`:`DEVICE_TOKEN` 和 Worker 的 secret 不一致

助理能聊天但工具都报「设备离线」:电脑端没连上,看上面几条。

本地联调 Worker:

```bash
cd worker
npx wrangler d1 execute roam --local --file=server/agent/schema.sql
npx wrangler dev --port 9507 --var SETTINGS_KEY:dev --var DEVICE_TOKEN:e2e-token
node tests/e2e.mjs     # 另开终端;假模型 + 假设备,跑一遍完整对话
node tests/extra.mjs   # 密码拦截、运行中停止
```

## 安全边界

- 终端输出、文件内容、屏幕截图只经 Worker 中继,不落地
- 助理的对话、设置存在你自己账号的 D1,图片存在 R2(可选);API Key 用 `SETTINGS_KEY` 加密保存,只在 Worker 里解密
- 只有带对 `DEVICE_TOKEN` 的电脑端能接入;访问密码由电脑端校验
- 助理能执行任意命令、读写文件、操作浏览器,权限等同于远程终端;务必设置 `SESSION_PASSWORD`
- 不设密码时,session id 就是唯一凭据,拿到链接的人能看到全部对话;用过的 session 链接即使电脑端已经换了 session 也依然有效
- 不要把真实 `computer/config.js` 和 `worker/wrangler.jsonc` 提交到仓库

## License

MIT

# Roam

**在手机上继续使用电脑里的 Claude Code / Codex** —— 把电脑端的终端 / 文件 / 屏幕带到任意设备的浏览器上。

机器不暴露公网。电脑端主动连 Cloudflare Worker,Worker 只做中继。远程网页只连 Worker,数据不落地。

| 终端 | 文件管理 | 系统状态 |
|---|---|---|
| ![终端](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/01-terminal.png) | ![文件管理](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/02-files.png) | ![系统状态](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/03-status.png) |

社区讨论: [LINUX DO](https://linux.do)

> **顺便打个广告**:我目前主力在做的另一个项目是 [AIOS](https://github.com/valueriver/AIOS) —— 用 AI 直接构建一个操作系统,欢迎去看看、Star、提 issue。

## 项目组成

```text
roam/
├─ worker/               # Cloudflare Worker + Vue 前端 + WebSocket 中继
├─ computer/             # 电脑端,提供终端 / 文件 / 屏幕 / AI 对话
└─ extension/            # browser-use Chrome 扩展,让 AI 经 CDP 驱动本机 Chrome
```

运行时链路:

```text
远程浏览器
  ↓ https / wss
Cloudflare Worker (中继,不存数据)
  ↓ wss
Roam Computer (终端 / 文件 / 屏幕)
```

## 能力

- 远程终端
- AI 对话(agent):跑在电脑端,可执行命令、控制键鼠/截图、驱动 Chrome
- 文件浏览、读取、上传、重命名、删除
- 屏幕截图查看
- 固定远程连接 session id

## 前置要求

- Node.js 22.13+(电脑端用内置的 `node:sqlite` 存对话)
- Cloudflare 账号
- 一台运行 Roam Computer 的电脑

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
    SESSION_ID: '',          // 留空则每次启动随机生成
    SESSION_PASSWORD: '',    // 留空则不要密码
    DEBUG: '0',
    BROWSER_BRIDGE_PORT: '9510', // 可选,本地浏览器 CDP 桥端口
};
```

## 启动 Computer

```bash
cd computer
npm start
```

控制台会输出:

- 远程访问入口 URL
- 访问密码(如果配置了)

## AI 助理

右上角宫格(应用中心)里的「助理」是内置的 agent,也是登录后的默认页;左上角菜单里是对话历史和新建对话。它跑在电脑端,模型请求从电脑直接发出,不经过 Worker。

1. 打开「设置」,填 OpenAI 兼容接口的 API 地址、API Key、模型名并保存
2. 回到「助理」直接说要做什么

配置、对话记录都存在电脑端 `~/.roam/roam.db`,网页端只能看到 Key 的掩码。

agent 可用的工具:

| 工具 | 说明 |
|---|---|
| `shell` | 以登录 shell 执行命令,和远程终端拿到的 PATH 一致 |
| `computer_*` / `open_app` | 截图、鼠标、键盘、打开应用(仅 macOS;鼠标和滚动需要 `brew install cliclick`) |
| `browser_cdp` | 经 Chrome DevTools Protocol 驱动本机 Chrome,需要装 `extension/` 扩展 |

上下文超过「压缩阈值」时,会自动把较早的消息总结成摘要,阈值和压缩提示词都能在设置里改。

截图需要在「系统设置 → 隐私与安全性 → 屏幕录制」里授权启动 Roam 的应用;键盘输入需要「辅助功能」授权。

### 浏览器控制

1. `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `extension/`
2. 点扩展图标,填入 computer 启动日志里打印的地址:`ws://127.0.0.1:9510/cdp?token=<session id>`
3. 显示「已连接」后,agent 就能用 `browser_cdp` 操作你已登录的 Chrome

CDP 桥只监听 `127.0.0.1`,并校验 token 是否等于当前 session id。

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

## 安全边界

- Worker 不保存终端输出、文件内容、对话或任何业务数据
- 真实数据保留在电脑端,对话和模型配置(含 API Key)在 `~/.roam/roam.db`
- AI 对话能执行任意命令、操作键鼠和浏览器,权限等同于远程终端;务必设置 `SESSION_PASSWORD`
- `SESSION_PASSWORD` 用于远程网页访问校验
- 不要把真实 `computer/config.js` 和 `worker/wrangler.jsonc` 提交到仓库

## License

MIT

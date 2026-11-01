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
├─ computer/             # 电脑端,提供终端 / 文件 / 屏幕 / AI 助理
└─ extension/            # Roam 浏览器插件,让助理操作本机 Chrome / Edge
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
- AI 助理(agent,来自 agentic):跑在电脑端,可执行命令、读写和修改文件、看图、操作浏览器
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

右上角宫格(应用中心)里的「助理」是内置的 agent,也是登录后的默认页;左上角菜单里是对话历史(置顶、拖拽排序、重命名、删除)和新建对话。agent 取自 [agentic](https://github.com/yanglongyun/agentic):跑在电脑端,模型请求从电脑直接发出,不经过 Worker。

1. 打开「设置」,填 Responses 接口地址(如 `https://api.openai.com/v1/responses`)、API Key、模型并保存
2. 回到「助理」直接说要做什么,可以附带图片(每条最多 5 张)

配置在电脑端 `~/.roam/agent/config.json`,对话在 `~/.roam/agent/chat.db`,图片在 `~/.roam/agent/images/`;网页端只能看到 Key 的掩码。

agent 可用的工具:

| 工具 | 说明 |
|---|---|
| `shell` | 执行终端命令(macOS / Linux 用 bash,Windows 用 PowerShell),超时会杀掉整个进程组 |
| `read` | 带行号读文本;PNG / JPEG / GIF / WebP 图片直接交给模型看 |
| `write` | 写入完整文件,自动创建父目录 |
| `edit` | 精确替换文本,默认要求唯一匹配 |
| `browser` | 操作 Chrome / Edge:只能操作自己打开的标签页,每个对话一个标签组;页面里的操作用 CDP,截图会交给模型看 |

模型请求失败(网络、429、5xx、断流)会自动重试两次。上次回复用掉的 token 达到「压缩阈值」时,会把较早的消息写成交接摘要,保留最近的若干条;阈值、保留条数、提示词、超时和输出上限都能在设置里改。

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

## 安全边界

- Worker 不保存终端输出、文件内容、对话或任何业务数据
- 真实数据保留在电脑端,助理的对话和模型配置(含 API Key)在 `~/.roam/agent/`
- 助理能执行任意命令、读写文件、操作浏览器,权限等同于远程终端;务必设置 `SESSION_PASSWORD`
- `SESSION_PASSWORD` 用于远程网页访问校验
- 不要把真实 `computer/config.js` 和 `worker/wrangler.jsonc` 提交到仓库

## License

MIT

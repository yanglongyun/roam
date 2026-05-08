# Roam

**在手机上继续使用电脑里的 Claude Code / Codex** —— 把本机的终端 / 文件 / 屏幕带到任意设备的浏览器上。

机器不暴露公网。本机 Server 主动连 Cloudflare Worker,Worker 只做中继。远程网页只连 Worker,数据不落地。

| 终端 | 文件管理 | 系统状态 |
|---|---|---|
| ![终端](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/01-terminal.png) | ![文件管理](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/02-files.png) | ![系统状态](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/03-status.png) |

> **顺便打个广告**:我目前主力在做的另一个项目是 [AIOS](https://github.com/valueriver/AIOS) —— 用 AI 直接构建一个操作系统,欢迎去看看、Star、提 issue。

## 项目组成

```text
roam/
├─ worker/               # Cloudflare Worker + Vue 前端 + WebSocket 中继
└─ server/               # 本机 Server,提供终端 / 文件 / 屏幕
```

运行时链路:

```text
远程浏览器
  ↓ https / wss
Cloudflare Worker (中继,不存数据)
  ↓ wss
本机 Roam Server (终端 / 文件 / 屏幕)
```

## 能力

- 远程终端
- 文件浏览、读取、上传、重命名、删除
- 屏幕截图查看
- 固定远程连接 session id

## 前置要求

- Node.js 20+
- Cloudflare 账号
- 一台运行 Roam Server 的本机电脑

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

## 配置 Server

```bash
cd ../server
npm install
cp config.example.js config.js
```

编辑 `server/config.js`:

```js
export default {
    CLOUDFLARE_WORKER_URL: 'https://roam.example.workers.dev',
    SESSION_ID: '',          // 留空则每次启动随机生成
    SESSION_PASSWORD: '',    // 留空则不要密码
    DEBUG: '0',
};
```

## 启动 Server

```bash
cd server
npm start
```

控制台会输出:

- 远程访问入口 URL
- 访问密码(如果配置了)

## 保活运行

希望关机/重启/网络抖动后 server 自动起来,各平台推荐做法:

### macOS

**临时(终端开着才活,关电脑前阻止休眠):**

```bash
caffeinate -dimsu node /path/to/roam/server/index.js
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
        <string>/Users/YOU/path/to/roam/server/index.js</string>
    </array>
    <key>WorkingDirectory</key><string>/Users/YOU/path/to/roam/server</string>
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

`which node` 看下你的 node 路径,nvm 装的话写 nvm 实际路径。

### Linux

用 systemd user service。新建 `~/.config/systemd/user/roam.service`:

```ini
[Unit]
Description=Roam Server
After=network-online.target

[Service]
ExecStart=/usr/bin/node /home/YOU/roam/server/index.js
WorkingDirectory=/home/YOU/roam/server
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
nssm install Roam "C:\Program Files\nodejs\node.exe" "C:\path\to\roam\server\index.js"
nssm set Roam AppDirectory "C:\path\to\roam\server"
nssm start Roam
nssm remove Roam confirm   # 卸载
```

或用任务计划程序触发器选"启动时",操作填 `node.exe` + 脚本路径。

## 排障

页面显示未连接:

- 确认 `server` 正在运行
- 确认 `CLOUDFLARE_WORKER_URL` 是当前部署的 Worker 地址
- 确认远程 URL 里的 `session` 和 Server 控制台打印的一致

## 安全边界

- Worker 不保存终端输出、文件内容或任何业务数据
- 真实数据保留在本机 Server
- `SESSION_PASSWORD` 用于远程网页访问校验
- 不要把真实 `server/config.js` 和 `worker/wrangler.jsonc` 提交到仓库

## License

MIT

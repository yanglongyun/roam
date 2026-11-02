# Roam

**在手机上继续使用电脑里的 Claude Code / Codex** —— 把一台或多台电脑的终端 / 文件 / 屏幕带到任意设备的浏览器上,再加一个跑在云端、能操作这些电脑的 AI 助理。

机器不暴露公网。每台电脑端主动连 Cloudflare Worker,远程网页也只连 Worker。终端、文件、屏幕的数据只经 Worker 中继,不落地;助理的对话和配置存在你自己 Cloudflare 账号的 D1 里。全部用免费额度,不用绑卡。

| 终端 | 文件管理 | 系统状态 |
|---|---|---|
| ![终端](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/01-terminal.png) | ![文件管理](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/02-files.png) | ![系统状态](https://pub-5cb9f2ea49ac433aba4c20d46cd886e7.r2.dev/posts/roam-v2/03-status.png) |

社区讨论: [LINUX DO](https://linux.do)

> **顺便打个广告**:我目前主力在做的另一个项目是 [AIOS](https://github.com/valueriver/AIOS) —— 用 AI 直接构建一个操作系统,欢迎去看看、Star、提 issue。

## 项目组成

```text
roam/
├─ worker/               # Cloudflare Worker + Vue 前端;一个 Durable Object（hub）负责中继、鉴权和 AI 助理
├─ computer/             # 电脑端,每台电脑跑一份,提供终端 / 文件 / 屏幕,并执行助理的工具调用
└─ extension/            # Roam 浏览器插件,让助理操作本机 Chrome / Edge
```

运行时链路:

```text
远程浏览器（任意数量）
  ↓ https / wss,访问密码由云端校验
Cloudflare Worker · hub（终端/文件/屏幕只中继;助理跑在这里,对话存 D1,图片存 R2(可选)）
  ↓ wss(带 DEVICE_TOKEN + device_id)
Roam Computer ×N（每台电脑一个设备 id:终端 / 文件 / 屏幕 / 执行助理的工具）
```

## 能力

- 多设备:任意数量的电脑接入同一个部署;网页右上角选设备,终端 / 文件 / 屏幕 / 状态都对着选中的那台
- 远程终端
- AI 助理(agent,来自 agentic):模型调用和对话在云端,电脑关机也能翻看历史;每个会话有默认设备,工具调用也可以用 `device` 参数指定任意一台在线设备执行,可执行命令、读写和修改文件、看图、操作浏览器。每台设备的名字和描述会进入助理的上下文,助理知道哪台机器是干什么的
- 文件浏览、读取、上传、重命名、删除
- 屏幕截图查看
- 访问密码在云端校验,登录后 30 天免密;电脑离线也能登录看历史

## 前置要求

- Node.js 22+
- Cloudflare 账号,免费计划就行(用到 Workers、Durable Objects、D1;想让助理收发图片再开 R2,开通 R2 要绑卡)
- 一台或多台运行 Roam Computer 的电脑

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

建表、设三个密钥(前两个用随机串,比如 `openssl rand -base64 32` 生成;第三个是你自己要输的访问密码):

```bash
npx wrangler d1 execute roam --remote --file=server/agent/schema.sql
npx wrangler secret put SETTINGS_KEY      # 加密保存模型 API Key 用,设了别再改
npx wrangler secret put DEVICE_TOKEN      # 电脑端接入凭据,所有电脑端 config.js 填同一个值
npx wrangler secret put ACCESS_PASSWORD   # 网页访问密码,云端校验;不设的话网页一律拒绝登录
```

部署:

```bash
npm run deploy
```

部署完成后得到 Worker 地址,例如:

- `https://roam.<your-subdomain>.workers.dev`
- `https://i.example.com`

这个地址就是网页入口,不带任何参数。

### 从旧版(单设备 / session 链接)升级

旧版把会话 id 当访问凭据、密码在电脑端校验。升级到多设备版要做三件事:

```bash
cd worker
npx wrangler d1 execute roam --remote --file=server/agent/migrate.sql   # devices 加 description 列、删 active 表
npx wrangler d1 execute roam --remote --file=server/agent/schema.sql    # 重建视图
npx wrangler secret put ACCESS_PASSWORD                                 # 把原来 computer/config.js 里的 SESSION_PASSWORD 填进来即可
npm run deploy
```

电脑端把 `config.js` 里的 `SESSION_ID`、`SESSION_PASSWORD`、`DEBUG` 删掉,重启后会生成新的设备 id。旧会话里 `device_id` 还是 `desktop`,在网页「设置 → 设备」里能看到新设备的 id,用一条 SQL 迁过去:

```bash
npx wrangler d1 execute roam --remote --command "UPDATE sessions SET device_id = '<新设备 id>' WHERE device_id = 'desktop'; DELETE FROM devices WHERE id = 'desktop'"
```

### 可选:开启图片(R2)

不开 R2 时,助理只能收发文字:网页上不显示发图按钮,`read` 读图片、`browser` 截图也看不到图片内容(浏览器工具改用读网页文字和元素位置)。

要开的话,先在 Cloudflare 控制台开通 R2(需要绑卡,免费额度每月 10 GB),然后:

```bash
npx wrangler r2 bucket create roam
```

把 `worker/wrangler.jsonc` 里 `r2_buckets` 段的注释去掉,再 `npm run deploy`。

## 配置 Computer

每台要接入的电脑都这样做一遍:

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
    DEVICE_NAME: '',         // 可选:这台设备的名字;留空用「用户名 的 Mac / 主机名」
    DEVICE_DESCRIPTION: '',  // 可选:一句话说明这台机器是干什么的,会进助理的上下文
};
```

也可以用环境变量或 `computer/.env`(见 `.env.example`)。`DEVICE_TOKEN` 不对时 Worker 会拒绝连接,控制台会提示。

设备 id 首次启动时自动生成,存在 `~/.roam/device.json`,之后一直复用;名字和描述只是初始值,在网页「设置 → 设备」里改过之后以云端为准。

## 启动 Computer

```bash
cd computer
npm start
```

控制台会输出设备 id 和远程访问入口 URL。浏览器打开入口,输入访问密码,右上角选这台设备就能用了。调试日志用环境变量开:`DEBUG=1 npm start`。

## AI 助理

右上角宫格(应用中心)里的「助理」是内置的 agent,也是登录后的默认页;左上角菜单里是对话历史(置顶、拖拽排序、重命名、删除)和新建对话。agent 取自 [agentic](https://github.com/yanglongyun/agentic),跑在 Worker 的 Durable Object 里:模型请求从 Worker 发出,需要动电脑时把工具调用经 WebSocket 发给对应设备执行,结果再送回云端。

1. 打开「设置」,填 Responses 接口地址(如 `https://api.openai.com/v1/responses`)、API Key、模型并保存;顺手给每台设备写一句描述
2. 回到「助理」直接说要做什么,可以附带图片(每条最多 5 张)

每个会话有一个默认设备(新建时取顶栏选中的那台,对话顶部那条栏可以换):模型不带 `device` 参数的工具调用都在它上面执行;要跨设备操作时模型会在参数里写明 `device`。目标设备不存在或离线,工具直接返回失败,不会落到别的设备上。

会话、消息、设置和设备登记存在 D1,图片存在 R2(没开 R2 就不收发图片);API Key 用 `SETTINGS_KEY` 加密后入库,网页端只能看到掩码。电脑端本机只留浏览器插件的管道、工具截图的临时目录(`~/.roam/agent/`)和设备 id(`~/.roam/device.json`)。

agent 可用的工具(设备工具都带可选参数 `device`):

| 工具 | 在哪执行 | 说明 |
|---|---|---|
| `shell` | 设备 | 执行终端命令(macOS / Linux 用 bash,Windows 用 PowerShell),超时会杀掉整个进程组 |
| `read` | 设备 | 带行号读文本;PNG / JPEG / GIF / WebP 图片直接交给模型看 |
| `write` | 设备 | 写入完整文件,自动创建父目录 |
| `edit` | 设备 | 精确替换文本,默认要求唯一匹配 |
| `browser` | 设备 | 操作该设备上的 Chrome / Edge,能力等同开发者工具:所有标签页都能操作(包括你已登录的页面),页面里的操作用 CDP,截图会交给模型看;还能调用下载、cookie、历史、书签、窗口、最近关闭等扩展接口;助理新开的标签页按对话放进标签组 |
| `sql` | 云端 | 查询和修改助理自己的 D1 数据(会话、消息、设备、设置等);所有设备离线时只有它能用 |

所有设备都离线时,对话照常能看、能发,这一轮模型只拿到 `sql` 工具,会如实告诉你需要先连上设备。模型请求失败(网络、429、5xx、断流)会自动重试两次。上次回复用掉的 token 达到「压缩阈值」时,会把较早的消息写成交接摘要,保留最近的若干条;阈值、保留条数、提示词、超时和输出上限都能在设置里改。

### 浏览器插件

在每台要让助理操作浏览器的电脑上:

1. Chrome / Edge 打开扩展程序页 → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `extension/`
2. 不用填任何地址:插件经原生消息连上本机的电脑端(电脑端启动时会把宿主登记到本机已安装的 Chromium 系浏览器,目前支持 macOS 和 Windows)
3. 想让助理打开本机文件(`file://`):在扩展程序页点 Roam 插件的「详情」,打开「允许访问文件网址」
4. 网页「设置 → 设备」里该设备标注「浏览器插件已连接」后,助理就能用 `browser` 工具操作它的浏览器。插件图标上的 `on` 只表示插件在尝试连接,以设置页为准

插件和电脑端之间走只有当前用户能连的本机管道(`~/.roam/agent/browser.sock`),不开端口。插件更新后要在扩展程序页点一下刷新。

插件权限是最高一档:`debugger`(开发者工具协议,能在任何页面里执行脚本、模拟真实点击和输入、截图)、全部站点、所有标签页,以及下载、cookie、历史、书签、最近关闭、常用网站。助理在你已登录的页面里操作就是以你的身份操作,提示词里要求它在提交、发送、付款、删除这类撤不回的动作前先问你。清浏览数据、管理其他扩展、改代理这类改浏览器本身的接口没有开放。Chrome 自己不允许扩展调试 `chrome://` 页面、应用商店和其他扩展的页面;被调试的标签页顶部会显示「正在调试此浏览器」,助理用 `detach` 可以让它消失。

## 保活运行

希望关机/重启/网络抖动后 computer 自动起来,各平台推荐做法:

### macOS

**临时(终端开着才活,关电脑前阻止休眠):**

```bash
caffeinate -dimsu node /path/to/roam/computer/index.js
```

**长期(开机自启,崩了自动拉起):** 用 launchd。新建 `~/Library/LaunchAgents/roam.computer.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>roam.computer</string>
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
launchctl load ~/Library/LaunchAgents/roam.computer.plist
launchctl unload ~/Library/LaunchAgents/roam.computer.plist  # 卸载
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

登录页提示「服务端未设置访问密码」:Worker 还没设 `ACCESS_PASSWORD`,执行 `npx wrangler secret put ACCESS_PASSWORD` 后刷新。

密码连错 10 次会锁 30 分钟,期间已登录的免密令牌也一并作废。

页面显示设备离线:

- 确认那台电脑的 `computer` 正在运行
- 确认 `CLOUDFLARE_WORKER_URL` 是当前部署的 Worker 地址
- 确认右上角选中的是那台设备
- Computer 控制台出现 `401`:`DEVICE_TOKEN` 和 Worker 的 secret 不一致
- Computer 控制台提示「本连接被替换」:同一个 `~/.roam/device.json` 被两台机器用了(比如复制了整个 home),删掉其中一台的这个文件重启

助理能聊天但工具都报「设备离线」或「设备不存在」:看对话顶部那条栏选的默认设备是哪台,换成在线的那台;模型在 `device` 参数里写了不存在的 id 就会报不存在。

本地联调 Worker:

```bash
cd worker
npx wrangler d1 execute roam --local --file=server/agent/schema.sql
npx wrangler dev --port 9507 --var SETTINGS_KEY:dev --var DEVICE_TOKEN:e2e-token --var ACCESS_PASSWORD:e2e-pass
node tests/e2e.mjs     # 另开终端;假模型 + 两台假设备,跑一遍鉴权、设备路由、工具往返、离线
node tests/extra.mjs   # 运行中停止、多网页共存、密码锁定(会把本地 hub 锁 30 分钟,放最后)
```

把本机电脑端接到本地 dev:`CLOUDFLARE_WORKER_URL=http://127.0.0.1:9507 DEVICE_TOKEN=e2e-token npm start`。

## 安全边界

- 终端输出、文件内容、屏幕截图只经 Worker 中继,不落地
- 助理的对话、设置、设备登记存在你自己账号的 D1,图片存在 R2(可选);API Key 用 `SETTINGS_KEY` 加密保存,只在 Worker 里解密
- 网页访问密码(`ACCESS_PASSWORD`)在云端校验,错 10 次锁 30 分钟;登录后 30 天内免密,锁定时所有免密令牌作废
- 只有带对 `DEVICE_TOKEN` 的电脑端能接入;这个令牌所有设备共用,丢了一台就要换掉并更新每台电脑
- 助理能执行任意命令、读写文件、操作浏览器,权限等同于远程终端;`ACCESS_PASSWORD` 用足够长的随机串
- 不要把真实 `computer/config.js` 和 `worker/wrangler.jsonc` 提交到仓库

## License

MIT

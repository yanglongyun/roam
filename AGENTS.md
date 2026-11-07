# roam

在手机上继续使用电脑里的 Claude Code / Codex。任意数量的电脑端主动连 Cloudflare Worker（带 `DEVICE_TOKEN` 和自己的 `device_id`）；网页只连 Worker，访问密码由 Worker 校验。终端 / 文件 / 屏幕只经 Worker 中继；助理（模型调用、会话、消息、图片）跑在 Worker 的 Durable Object 里，电脑端只负责执行 shell / 文件 / 浏览器这些工具。

- origin: `https://github.com/yanglongyun/roam.git`

## 结构

- `worker/`：Cloudflare Worker + Vue 前端；只有一个 Durable Object `TerminalSessionManager`（`idFromName('hub')`），承载所有 WebSocket、HTTP 业务接口、鉴权、终端中继和助理。
- `worker/server/index.js`：hub 本体。网页 `auth.submit { password }` 对 `env.ACCESS_PASSWORD` 做 timingSafeEqual，通过后发 30 天令牌；错 10 次锁 30 分钟（计数在 DO storage），锁定时清空所有令牌；DO 启动时比对 `ACCESS_PASSWORD` 的指纹（存在 storage 的 `passwordFingerprint`，是 SHA-256 不是密码），变了就清空所有令牌——改 secret 会重新部署、DO 必然重启，所以只在构造函数里比；没设 `ACCESS_PASSWORD` 时网页一律 `auth.state { closed }`。电脑端 socket 打 tag `desktop:<device_id>`，`sendToDevice(deviceId, msg)` 按 tag 发；同一 device_id 重连会把旧连接 4002 关掉。`connection.devices` 给网页的是设备列表（D1 登记 + 在线状态）；`web.joined { clientId }` 通知各电脑端把终端快照发给刚登录的网页。
- `worker/server/agent/`：助理本体：`api.js` 的 `callOp` 是网页用的 op 表（含 `devices.*`、`tasks.*`、`router.open`，会话不绑设备），`runner.js` 的 `pickTarget` 在创建任务时选择设备（没填时只有一台在线就用它，多台在线报错；不存在 / 离线直接失败），运行时只用任务绑定设备，`rpc.js` 是设备工具桥（pending 按 device_id 记，断开只 drain 自己的），`tools.js` 里的设备工具只提供给任务，运行时固定设备，`describeDevices` / `describeAvailability` 生成系统提示里的设备清单，`config.js` 的 `renderPrompt(text, { devices, tasks, goal, device, workdir })` 支持 `{{devices}}`、`{{tasks}}`、`{{time}}` 等。数据在 D1 + R2（`schema.sql`；旧库升级看 `migrate.sql` 开头的说明）。
- `worker/server/agent/tasks.js` + `schema.sql` 的 `tasks` 表 / `v_tasks` 视图：任务的控制面。任务就是一个会话（`tasks.id = sessions.id`），执行过程全在 `messages` 里，`tasks` 只存 Router 每轮都要读的热点（状态 / 进度 / 设备 / 工作目录 / 预算 / 步数和花费），所以助理提示词和任务列表不用扫消息。`markStale` 在 DO 启动时把还标着在跑的改成 `interrupted`。
- 两种角色（`listTools({ mode })` + `api.js` 的 `reply(ctx, id, state, { kind })`）：`router`（固定 id 为 `router` 的助理会话，工具是 `dispatch_task / tasks / steer_task / cancel_task / sql`，拿不到设备工具，提示词模板是 `config.router_system`，`{{tasks}}` 每轮现取任务快照）、`task`（工具是设备工具 + `report`，没有 `device` 参数，设备在派发时绑死，提示词是 `config.task_system`，工作目录优先用任务自己的）。任务循环和人的会话循环各自独立，`ctx.runs` 里按会话 id 并存，互不阻塞。
- 任务的运行：`dispatch_task` 建 `tasks` 行 + 同 id 的会话，`startTaskRun` 起一轮 `reply({kind: 'task'})`；进度靠任务自己调 `report`（写 `progress`，`needs_human` 会把状态停在等人决定，收尾时也不会被"完成"盖掉）；每次 `usage` 事件按 SQL 自增 `steps` / `cost` 并检查预算（超了 abort，状态记 `failed` 并写明原因）；收尾时按 `run` 的结果映射成 `done / cancelled / failed`。给任务发话（会话里发消息或 `tasks.steer`）= 追加指令：先 abort 当前这一轮（`state.steer = true`，不写结束状态），再带着完整上下文重跑。任务会话不在 `sessions.list` 里（`NOT_TASK` 排除任务和 `router`），删会话时连 `tasks` 行一起删。
- 主动汇报：`notifications.js` + D1 `task_notifications` 是持久化投递队列，任务收尾用 `patchTask(..., notification)` 将状态和通知原子提交；`flushTaskNotifications` 在助理空闲时把通知写入 Router 会话并调用模型，忙时等当前轮收尾，最多合并 20 条。输入消息和 `message_id` 一起提交，重试复用原消息；助理成功处理后才确认，失败退避重试（最多 3 次，改模型配置会重置），用户主动停止则不立即重启同一轮。DO 启动将中断任务入队并安排 alarm 补投，网页离线也照常处理。通知来源字段经 `sessions.open/messages.list/agent.event` 给前端，显示为可点击的系统通知；`task_report` 提示助理入口未读。部署前跑一次 `schema.sql` 增加队列表；独立回归：`cd worker && node tests/notifications.mjs`。
- 派发必填 `title`（简短单行名称，最多 60 字）和 `goal`（完整目标与验收标准，最多 2000 字），与 `tasks` 行在同一 D1 batch 中创建。`sessions.title` 是任务名称的唯一来源，创建时的首条用户消息是完整目标的唯一来源，查询通过 `idx_messages_session` 定位首条，不额外保存第二份目标。不能只把目标放进系统提示，否则首轮 `input: []` 会被模型接口拒绝。`PATCH /api/agent/tasks/:id {title}` 只改名称，不改目标或消息；任务不能再通过 sessions.patch 改名。列表、详情标题栏、通知统一用 title，通知 HTTP / WS 字段是 `task_title`；详情返回入口在标题栏，状态栏不重复展示目标或结束结果。已有记录不自动改写、补填或迁移。失败进度保留模型的具体错误；Router 的 `sql` 把 `{ sql, params }` 整个对象交给 `runSql`。
- `computer/`：电脑端，每台电脑一份；配置在 `config.js`（或 `.env` / 环境变量），必填 `CLOUDFLARE_WORKER_URL` 和 `DEVICE_TOKEN`，可选 `DEVICE_NAME`、`DEVICE_DESCRIPTION`；`DEBUG=1` 只认环境变量。设备 id 由 `core/device.js` 首次生成写入 `~/.roam/device.json`。密码校验已经不在电脑端（没有 guard 了）。
- 本机启动偏好：用户明确要求只在终端手动执行 `cd computer && npm start`。`roam.computer` LaunchAgent 已卸载，配置保存在 `~/.roam/disabled-launch-agents/roam.computer.plist`。除非用户之后明确要求后台运行，不配置、加载或恢复自启服务。
- Computer 单实例：`index.js` 先调用 `core/single-instance.js` 取得当前用户的运行锁，再动态加载配置、设备身份和服务；重复启动仅提示并正常退出，不能先启动浏览器管道（它会清理 socket 文件）或终端。macOS / Unix 用 `flock`，Windows 用按用户目录命名的系统 mutex；内核负责异常退出时释放，`~/.roam/computer.lock` 的 PID 仅供提示，不能通过 PID / 超时判断占用，也不能 unlink 该文件。`ws.js` 只装配配置，`core/connection.js` 是连接生命周期唯一来源：4002 被替换后停止自动重连，普通掉线 3 秒重连；主动 close 先停止再关 socket，不能被 close 事件重新拉起。回归：`node computer/tests/instance.mjs`、`node computer/tests/connection.mjs`。
- macOS 截图在 `computer/core/screenshot.js`：系统命令固定用 `/usr/sbin/screencapture` 和 `/usr/bin/sips`，不能依赖 launchd 的 PATH。权限检查在 `mac-screen-access.js`；终端启动时 macOS 可能把权限归给 Terminal，launchd 启动时归给实际 node 路径。排查先看当前进程、TCC 日志和原始命令错误，不把 ENOENT 误报成权限或显示器问题。同一设备只运行一个 Computer，已配置后台服务时不要再手动启动第二份。
- 轻量远程屏幕：`stores/screen.js` 是网页屏幕会话的唯一状态源，`ScreenView.vue` 激活时启动、keep-alive 停用 / 页面隐藏 / pagehide / 断线时取消在途请求并停止计时，默认每 2 秒请求一张、同一网页不重叠。`screen.request {reqId, action: capture|input|permission}` / `screen.cancel {reqId}` 经 WS 中继；电脑端 `services/screen/session.js` 将所有截图和输入串行，`screen.result` 只回复 `meta.clientId` 指定网页；Worker 在网页断开时发送 `web.left`，电脑端取消该网页的排队工作、清除画面。没有电脑端定时推屏或 D1 历史记录。输入必须附属于当前网页的 `frameId`，画面有效 60 秒，保留最近 4 张以处理在途截图；布局改变拒绝旧坐标，任何输入后全设备旧画面失效。macOS 用 `-m` 截主屏、`CGDisplayBounds` 逻辑坐标换算归一化点击位置，`mac-screen-control.js` 通过 CoreGraphics 发点击 / Unicode 文字 / 按键 / 滚动；每次操作检查控制授权。macOS 27 设置页叫「设备控制和数据访问」，对应 Accessibility 权限；「打开权限设置」请求系统授权并打开设置，不代替用户授权。目前其他系统支持查看，不支持控制。回归：`node computer/tests/screen.mjs`、`cd worker && node tests/screen.mjs`。
- 任务桌面工具 `computer`：`agent/functions/computer.js` 通过屏幕服务的 `perform` 与手动屏幕共用唯一队列；按任务隔离画面，截图像素坐标由服务换算，输入与 250ms 后的新截图作为一次队列操作返回。仅对 macOS 且绑定 R2 的任务提供，云端 runner 在下发前再次校验；模型须支持图片输入。沿既有工具图片链落 R2，`ai.prepareImages` 只将最近两张桌面截图发给模型，不改历史或用户上传图片。`DeviceBridge` 在停止 / 超时时发 `tool.cancel`，电脑端按调用 id 取消，断线取消全部工具。助理仍只派任务；任务结束与人工决定沿既有通知队列汇报。回归：`node computer/tests/computer.mjs`、`cd worker && node tests/computer.mjs`、`node tests/computer-e2e.mjs`（隔离 Worker / D1 / R2 + 模拟模型及桌面，不操作用户电脑）。
- `computer/services/agent/`：电脑端只剩工具执行（`agent/functions/*`）和浏览器桥，`device.report` 上报 id / 名字 / 描述 / 环境，`tool.result` 发 `to: 'server'`。
- `computer/services/agent/browser/`：对应 agentic launcher 的浏览器桥、原生消息宿主和宿主登记；宿主名 `yun.roam.browser`。
- `extension/`：Roam 浏览器插件（取自 agentic 插件），manifest 里的 key 决定固定 ID `opkcnndhnmkilimegkcgeecanhjebpge`，要和 `register-host.js` 一致。权限按最高能力给：`debugger` + `<all_urls>` + 所有标签页，`chrome` 动作开放 tabs / windows / tabGroups / downloads / cookies / history / bookmarks / sessions / topSites 这几个命名空间；browsingData、management、proxy 这类改浏览器本身的故意不开。浏览器工具的执行在 `computer/services/agent/agent/functions/browser.js`，给模型的说明在 `worker/server/agent/tools.js`，三处要一起改。
- `worker/src/`：应用中心里的「助理」(`/assistant`, `AssistantView.vue`) 和「任务」(`/tasks` 和 `/tasks/:id`, `TasksView.vue`) 是独立应用。助理直接打开固定 Router 会话，任务页列出状态和进度，可用 `NewTaskModal.vue` 手动创建任务（目标 / 在线设备 / 可选工作目录及预算），详情里可发消息追加指令、停止。手动创建走 `tasks.dispatch`，与助理派发共享执行和自动汇报链。独立「对话」应用和普通对话 store 已删除，`/chat` 旧链接跳转助理，旧会话数据仍保留，`sessions.create` 和向普通会话发消息返回 410。`useAssistantStore / useTaskAgentStore` 分别保存消息、运行态和按会话保存的草稿，`stores/agent-client.js` 通过 HTTP 发业务请求、通过 WS 收实时事件，共用模型状态和全局配置接口。`ConversationPane.vue` 用 provide/inject 给消息、工具、输入组件注入对应 store。`stores/ws.js` 持有设备清单和当前设备，设备选择只显示在终端 / 文件 / 屏幕 / 状态页；设置页管理设备登记。

## 链路

```
远程浏览器 ×N ──HTTPS（查询 / 写入）+ wss（登录 / 实时事件）──> hub DO（终端中继 + 助理 + D1/R2） ──wss + DEVICE_TOKEN + device_id──> Roam Computer ×N
```

## 消息路由

- `to: 'web'` 全部已登录网页；`to: 'web:<clientId>'` 某个网页；`to: 'device:<id>'` 某台电脑（只有网页能发）；`to: 'hub'` / `'server'` 是给 DO 自己的（`auth.submit`、`agent.request`、`device.report`、`tool.result`、`devices.list`），DO 按 type 拦截，不看 to。
- DO 转发来自电脑端的消息时补 `meta.deviceId`；来自网页的补 `meta.clientId`。

## 能力

- 远程终端、AI 助理（设备上执行 shell / read / write / edit / browser / computer，云端执行 sql；Responses 接口，重试、上下文压缩）、任务（助理只派活，任务在自己的会话里并发跑，可追加指令 / 停止 / 设预算）、文件浏览/读取/上传/重命名/删除、屏幕截图、多设备。
- 业务请求走 HTTP：`shared/agent-http.js` 定义前后端共用的资源路由，`server/agent/http.js` 解析请求并复用 `callOp`。`GET /api/agent/sessions/:id` 返回最近 60 条、摘要和运行快照；`GET /api/agent/sessions/:id/messages?before=<消息id>&limit=60` 向前分页；任务列表 / 详情、设置、设备、用量也用 GET，创建和发送用 POST，更新用 PUT/PATCH，删除用 DELETE。所有 HTTP 业务接口经 hub 校验 `Authorization: Bearer <网页登录令牌>`（包含过期 / 锁定），响应 `Cache-Control: no-store`；不能把 HTTP 令牌放查询串。旧 `agent.request/agent.result` 只为已打开的旧页面保留兼容，新前端不再发送。
- 实时输出仍走 WS `agent.event`：`session_id` + 事件字段平铺，类型 `message` / `reasoning`（`delta` 或完整 `item`）/ `function_call` / `function_call_output` / `usage` / `compact` / `retry` / `error` / `done`。事件附 `event_cursor {epoch, sequence}`；会话 HTTP 查询前同步捕获游标和流式状态，前端查询期间缓存事件、返回后重放游标之后的事件，数据库消息按 id 去重，usage 按 `message_id` 附着。重连后重新 HTTP 拉快照，WS 断开时已登录用户仍可查询历史 / 列表、分页。前端回归 `node tests/apps.mjs`，真实 Worker / D1 的 HTTP 鉴权、分页、断线查询和自动汇报回归 `node tests/notifications.mjs`。
- 用量与费用：每次模型调用（含上下文压缩）都把 `usage`（token 数与 `model`）写进 `messages.usage` / `compactions.usage`；**金额不落库**，读的时候按 `server/agent/pricing.js` 的单价现算，所以改单价历史会自动重算。单价是 DeepSeek 官方 USD 价，区分高峰/空闲（北京时间工作日 9-12、14-18 点为高峰，没有节假日数据时一律按高峰，金额只会高估）；查不到单价的模型只显示 token。API 里 `config.put` 收 `pricing.models`（与默认表合并，`null` 项删除覆盖），`usage.stats { tz_offset }` 返回今日 / 本月 / 合计 + `by_model` + 近 14 天 `by_day`，多币种不混算、汇总取金额最大的币种。用量在应用中心是单独一个「用量」应用（`/usage`，`views/UsageView.vue`）：今日/本月/合计、近 14 天柱状图、按模型、以及只读的单价表。
- API Key 用 `SETTINGS_KEY` 加密后存 D1，只在 DO 里解密使用；模型请求从 Worker 发出，电脑端只收 `tool.call`。
- 电脑端接入要带 `Authorization: Bearer <DEVICE_TOKEN>` 和 `device_id`（`[A-Za-z0-9_-]{8,64}`），Worker 在转给 DO 之前校验令牌，不对就 401。
- `devices.name / description` 以云端为准：电脑端上报的值只在云端为空时写入（`COALESCE(NULLIF(...))`）。
- R2（绑定名 `IMAGES`）是可选的：开通 R2 要绑卡，开源用户多半没有。没绑时 `status.get` 返回 `images: false`，前端隐藏发图按钮，上传和带图发送直接报错，工具截图换成一句文字说明，提示词里也会告诉模型看不到图；历史里取不到的图片在发给模型时换成 `[图片不可用]`，不让整次请求失败。
- D1 是整个部署共用的（一个部署 = 一个用户），不按设备隔离。
- 界面：右上角宫格是应用中心（助理 / 任务 / 终端 / 文件 / 状态 / 用量 / 屏幕 / 设置），应用清单在 `stores/view.js`，`appOf` 支持任务详情这样的子路径。默认登录后进入 `/assistant`；左上角菜单只给终端列表，任务列表是独立页面。前端应用隔离回归：`cd worker && node tests/apps.mjs`（无需 Worker / 真实模型）。

## 命令

各子项目自己的 `package.json` 为准：

- `worker/`：Vite + Wrangler，开发用 `npm run dev`，部署 `npm run deploy`（按用户偏好直接 deploy）。
- 本地联调：`npx wrangler d1 execute roam --local --file=server/agent/schema.sql` 建表后 `npx wrangler dev --port 9507 --var SETTINGS_KEY:dev --var DEVICE_TOKEN:e2e-token --var ACCESS_PASSWORD:e2e-pass`，再 `node tests/e2e.mjs`（假模型 + 两台假设备：鉴权、设备描述、系统提示里的设备清单、手动任务绑定设备、助理不能执行设备工具、独立对话接口关闭、多台在线创建必须指定设备、只剩一台时自动选择、不存在 / 离线失败、终端消息路由、同 id 重连）、`node tests/tasks.mjs`（假模型 9612，按提示词区分助理 / 任务两条队列：派活、任务在绑定设备上跑完写进度、助理下一轮看到任务快照、追加指令重开、needs_human 不被完成盖掉、取消、预算超限、工具集隔离、删会话连带删任务行）、`node tests/extra.mjs`（运行中停止、多网页共存、密码锁定——会把本地 hub 锁 30 分钟，放最后；要重跑就删 `.wrangler/state/v3/do` 重启 dev）和 `node tests/billing.mjs`（假模型 9613，校验实时 / 历史金额、`usage.model`、`usage.stats` 各字段、非法时区被拒；跑完会把 hub 锁掉，最好用独立状态目录：`--persist-to /tmp/bill-state` 另起一个 dev，再 `PORT=9508 node tests/billing.mjs`）。e2e / extra 的测试脚本里写的端口是 9507。`wrangler d1 execute` 在本机偶尔执行完不退出，加 `CI=1` 或直接杀掉即可。
- 把本机电脑端接到本地 dev：`CLOUDFLARE_WORKER_URL=http://127.0.0.1:9507 DEVICE_TOKEN=e2e-token node computer/index.js`（环境变量覆盖 config.js）。
- `computer/`：看 `computer/package.json` 入口。

## 注意

- 主动通知升级必须先确认远程 `sqlite_master` 中已有 `task_notifications` 表及两个索引，再部署依赖它的 Worker。迁移命令出现网络错误或超时时不能当作完成，要先查询确认并补齐，避免 DO 构造阶段因缺表失败。
- 部署 Worker 前确认 `wrangler.jsonc` 的 `account_id` 是要部署的账号；D1 `roam`、R2 `roam` 已建，表已建（`schema.sql` 里的表全是 `IF NOT EXISTS`，改了结构再跑一遍；加任务只多了一张 `tasks` 表和 `v_tasks` 视图，再跑一遍 `schema.sql` 即可；`v_devices` 视图会先 DROP 再建，`v_compactions` 加列时要手动 `DROP VIEW` 再跑 schema.sql）。计费上线时对老库做过：`ALTER TABLE compactions ADD COLUMN usage TEXT` + 重建 `v_compactions`。
- `assets.run_worker_first` 要包含 `/api/*` 和 `/ws`，避免 API 请求被 SPA 回退拦截；Vite 开发代理也必须转发 `/api`。
- Worker secret：`SETTINGS_KEY`（加密 API Key，改了之前存的 Key 就解不开）、`DEVICE_TOKEN`（所有电脑端 `config.js` 里是同一个值）、`ACCESS_PASSWORD`（网页访问密码）。
- 不提交 `node_modules`、`.wrangler`、本地配置和凭据。

<div align="center">

```
      .                ·               .
                          _
                        _/ \_
              _       _/     \_
            _/ \_    /         \_
          _/     \__/             \___
        _/                             \__
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

# Roam · 漫游

**把家里电脑变成你的云开发机 —— 运行在 AIOS 之上。**

</div>

---

## 🚨 老版本用户请看

> **Roam v2 (Cloudflare Worker 版) 已归档为 [`ROAM-v2.zip`](./ROAM-v2.zip)**
>
> 这个仓库的 `main` 分支现在是全新的 v4 架构。如果你之前在用 v2 —— 桌面端和浏览器都通过 Cloudflare Worker + Durable Object 做中继的版本,
> **继续使用 v2 的方法**:
>
> 1. 从本仓库根目录下载 [`ROAM-v2.zip`](./ROAM-v2.zip)
> 2. 解压,按包内 README 配置 Cloudflare Worker
>
> v4 不再依赖 Cloudflare。公网穿透自己挑工具 (ngrok / Cloudflare Tunnel / Tailscale / 局域网裸跑),Roam 只负责家里电脑这一头。

---

## v4 最大的变化: **Roam 由 AIOS 驱动**

v2/v3 是一个"把三件死功能(Agent / Shell / Files)通过 Cloudflare 暴露到浏览器"的工具。
v4 把这一切搬到 [AIOS](https://github.com/valueriver/aios)—— 一个 AI 原生的操作系统内核 —— 上重写。**这是架构与理念上的范式切换**,不是功能迭代。

### AIOS 带进来了什么

**1. Agent 不再是聊天框,是 OS 驱动器**

AIOS 里 agent 是系统级服务。它看得见系统里的所有应用,能理解每个应用的数据结构、调用后端 API、生成并运行代码、管理会话/工具/技能/记忆。
Roam 的 Agent app 就是这个核心服务的对话入口 —— 你在聊天框里说一句"把 ~/Downloads 里本周下载的 dmg 全删了",它能真的去终端里跑、去文件系统里动、返回结果 —— 因为终端和文件不是前端功能,是 agent 可调度的**系统能力**。

**2. 双进程内核:稳定内核 + 可热重启应用层**

```
┌─────────────────────────────────────┐
│ main 进程 (9506) — 稳定内核         │
│ · HTTP + WebSocket                  │
│ · Agent + LLM 流式调用              │
│ · pty 终端 · 文件系统 · 任务管理    │
│ · 对话连接不断                      │
├─────────────────────────────────────┤
│ apps 进程 (9507) — 应用运行时       │
│ · 每个 app 独立模块 + 独立 DB       │
│ · 可热重启不影响 main               │
│ · 为 AI 生成的应用预留              │
└─────────────────────────────────────┘
```

apps 进程能被热重启,是为了支持"agent 现场写一个新 app,立即可用"这种 AIOS 原生能力 —— 重启 apps 时,你在 Agent 里的对话、正在跑的终端、未完的任务都不中断。

**3. Task 系统:应用可以反向调度 agent**

AIOS 有一套 `/api/task/*`。任何应用(包括将来 AI 生成的)可以把一段工作扔给 agent 后台跑 —— 即时模式(单次 LLM 调用)或长循环模式(完整工具循环)。顶栏右上角的时钟图标实时显示所有任务状态。

**4. 应用注册表:插件式架构**

`gui/src/apps.js` + `server/apps/registry.js` 是 AIOS 的应用注册机制。当前只注册了三个(agent / shell / files),目录和接口契约都已经铺好 —— 未来新增应用只是往注册表里填一行,不是重写壳层。

---

## 现在能做什么

三个核心 app,都是 AIOS 视角下的"系统应用",不是独立组件:

| | |
|--|--|
| 💬 **Agent** | 对话式 AI 助手。AIOS 的核心。支持持久会话、多模型切换、工具调用可视化 |
| 🖥 **Shell**  | xterm 多标签终端,触屏键盘。pty 是 agent 的工具之一,你和 agent 看到的是同一个 shell |
| 📂 **Files** | 浏览任意目录、预览、上传、下载、重命名、搜索、排序。文件系统同样对 agent 开放 |

界面风格:Linear 冷中性色,支持明暗双主题(顶栏右上角切换)。

---

## 启动

要求:Node.js 20+,macOS / Linux (Windows 理论可但未测)。

```bash
git clone https://github.com/valueriver/ROAM.git roam
cd roam
npm install          # 会自动 chmod node-pty 的 spawn-helper
npm run build        # 构建前端到 gui/dist
npm start            # 起 main + apps 两个进程
```

打开 <http://localhost:9506>,右上角齿轮配模型,开始用。

- `npm run start:main` — 只起内核进程
- `npm run start:apps` — 只起应用进程
- `npm run dev` — main + apps + vite dev server

---

## 暴露到公网(可选)

v4 默认只绑 `127.0.0.1`。想远程用,挑一个隧道:

### ngrok(最省事)
```bash
ngrok http 9506
```

### Cloudflare Tunnel(长期域名)
```bash
brew install cloudflared
cloudflared tunnel create roam
cloudflared tunnel route dns roam roam.你的域.com
cloudflared tunnel --url http://localhost:9506 run roam
```
配合 Cloudflare Zero Trust Access 锁定访问。

### Tailscale Serve
```bash
tailscale serve --bg 9506
```
只有 tailnet 成员可访问。

---

## 目录结构

```
roam-v4/
├── server/
│   ├── main/                 # 稳定内核进程
│   │   ├── agent/            # 对话循环 + 工具编排
│   │   ├── llm/              # OpenAI 兼容流式客户端
│   │   ├── prompt/           # 系统提示词组装
│   │   ├── chat/             # 会话持久化
│   │   ├── terminal/         # pty + WS (/ws/terminals)
│   │   ├── api/              # REST 路由分发
│   │   ├── service/          # auth / settings / files / system
│   │   ├── task/             # 后台 AI 任务管理
│   │   ├── repository/       # SQLite 读写
│   │   └── system/           # http / ws / 目录初始化
│   ├── apps/                 # 应用进程 (空 registry, 框架预留)
│   │   ├── index.js
│   │   ├── registry.js
│   │   └── app_shared/       # agentTask + instantTask 给应用派发 AI 任务
│   └── shared/               # main + apps 共用
├── gui/
│   └── src/
│       ├── apps/
│       │   ├── chat/         # Agent UI
│       │   ├── shell/        # 终端 UI
│       │   ├── files/        # 文件 UI
│       │   └── settings/     # 模型配置
│       ├── components/       # AppHeader / AppDrawer / ConnectionGate / ToastHost / TaskIndicator / TaskPanel
│       ├── stores/           # ws / theme / view / tasks / agent / files / terminal / snippets ...
│       └── views/            # DesktopView (壳) + GuardView
├── scripts/
│   ├── start.mjs             # i18n 烘焙 (prestart hook)
│   ├── run.mjs               # 一键启动两进程
│   └── fix-node-pty.js       # postinstall: chmod spawn-helper
└── language/                 # zh/en 文案
```

---

## 和 v2 的差异

| | v2 | v4 |
|--|--|--|
| 架构内核 | 无,直接 Fastify 服务三个功能 | **AIOS 驱动** — agent/llm/prompt/task 四大子系统 |
| 部署模型 | 桌面和浏览器都拨 Cloudflare Worker + DO 做中继 | 桌面端本地 HTTP/WS,公网穿透自带工具 |
| 依赖 | 需要 CF 账号、`wrangler deploy`、Workers 付费计划 | 零外部依赖,全本地 |
| 后端进程 | 单进程 | 双进程(main 稳定 + apps 可热重启) |
| 应用模型 | 三个功能写死在代码里 | 插件式注册表,为 AI 生成应用预留接口 |
| Agent 角色 | 一个会调工具的聊天框 | OS 级服务,系统内全部能力对它开放 |
| 前端 | Vue 3 + Pinia | 同上,换 Linear 风格设计系统,支持明暗主题 |
| 认证 | Cloudflare Access / 密码门 | 本地默认无认证 (localhost 够用),公网穿透时建议套 CF Access / Tailscale |

---

## 致谢

- [AIOS](https://github.com/valueriver/aios) — 提供了双进程内核、agent/llm/prompt/task 子系统,以及"AI 原生操作系统"的设计思路
- [xterm.js](https://xtermjs.org/) · [node-pty](https://github.com/microsoft/node-pty) · [Vue](https://vuejs.org/) · [Tailwind](https://tailwindcss.com/)

## License

MIT

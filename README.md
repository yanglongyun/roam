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

# Meem

把你的电脑能力，通过浏览器远程带出来。

</div>

---

## 这是什么

Meem 由两部分组成：

- [`worker/`](/D:/Code/meem/worker)：Cloudflare Worker + Web 前端
- [`client/`](/D:/Code/meem/client)：运行在你本机上的 Client

`worker` 负责：

- 远程访问入口
- WebSocket 中继
- 前端界面
- 会话接入

`client` 负责：

- 终端
- 文件
- 屏幕截图
- 浏览器能力
- Agents

目标很直接：不用暴露端口，不用 SSH，不用 VPN，在任意设备的浏览器里接回你自己的机器。

---

## 当前架构

`client` 已经按四层结构重组：

```text
client/
├─ agents/   # 多 agent 核心层，负责任务理解、委派、工具编排
├─ llm/      # 大模型兼容抽象层，维护 provider catalog 与请求/解析流水线
├─ server/   # 纯服务层，负责 ws、路由、本地浏览器扩展 bridge
├─ apps/     # 具体能力层，如 terminal / files / screen / guard / claude-code
├─ core/     # 少量共享基础模块
├─ db.js
└─ index.js
```

职责边界：

- `agents` 负责“决定做什么”
- `apps` 负责“真正去做”
- `server` 负责“把服务接起来”
- `llm` 负责“把不同模型接成统一接口”

这不是单 agent 结构，而是多 agent 结构。

当前内置 3 个 agent：

- `main`：主控 agent，负责理解用户任务和选择执行路径
- `browser`：浏览器子 agent，负责当前浏览器、当前标签页、当前登录状态
- `playwright`：Playwright 子 agent，负责独立受控浏览器自动化

---

## 浏览器能力设计

Meem 现在同时支持两条浏览器路径。

### 1. 当前浏览器路径

由根目录的 [`chrome-extension/`](/D:/Code/meem/chrome-extension) + 本地 bridge 提供。

特点：

- 复用用户当前浏览器
- 复用当前标签页
- 复用当前登录状态
- 更适合已登录网站、运营后台、当前页面读取与控制

主控 agent 会把这类任务委派给 `browser` 子 agent。

### 2. 独立 Playwright 路径

由 `client` 本机直接启动受控浏览器。

特点：

- 独立浏览器实例
- 不依赖用户当前浏览器状态
- 更适合稳定自动化流程
- 更适合隔离执行

主控 agent 会把这类任务委派给 `playwright` 子 agent。

---

## LLM Provider Catalog

`client/llm` 参考了 AIOS 的设计思路，前后端共享同一份 provider catalog。

当前做法：

- 后端在 [`client/llm/providers.js`](/D:/Code/meem/client/llm/providers.js) 维护 provider 列表
- `worker` 前端不再写死 providers
- 前端通过 `agent.providers` 动态接收 provider groups 和 provider 列表

这意味着：

- provider 配置入口只有一份
- 前端设置页和后端运行时不再漂移
- 新增 provider 时，不需要再手动同步一份前端常量

---

## 功能

- 远程终端
- 文件浏览、读取、上传、重命名、删除
- 屏幕截图查看
- 多 session Agent
- 当前浏览器控制
- Playwright 自动化
- SQLite 本地持久化

本地数据库默认位置：

- Windows：`C:\Users\<用户名>\.meem\meem.db`
- Linux / WSL / macOS：`~/.meem/meem.db`

---

## 目录结构

```text
meem/
├─ worker/               # Cloudflare Worker + Web 前端
│  ├─ server/
│  └─ src/
├─ client/               # 本机 Client
│  ├─ agents/            # 多 agent 运行时
│  │  ├─ main/
│  │  ├─ browser/
│  │  └─ playwright/
│  ├─ llm/               # provider + input/output/requester pipeline
│  ├─ server/            # ws / router / browser-extension bridge
│  ├─ apps/              # terminal / files / screen / guard / claude-code
│  └─ core/
└─ chrome-extension/     # Chrome 扩展，连接本地浏览器 bridge
```

---

## 部署

前置要求：

- Cloudflare 账号
- Node.js 20+
- 一台常开的电脑
- Windows 下如果要编译原生模块，需要 Visual Studio Build Tools 2022 + Desktop development with C++

### 1. 部署 Worker

```bash
git clone https://github.com/valueriver/meem
cd meem/worker
npm install
cp wrangler.example.jsonc wrangler.jsonc
```

然后编辑 [`worker/wrangler.jsonc`](/D:/Code/meem/worker/wrangler.jsonc)，填好 Cloudflare 配置。

部署：

```bash
npm run deploy
```

部署后你会拿到一个 `workers.dev` 地址，或者你自己的绑定域名。

### 2. 配置并启动 Client

```bash
cd ../client
npm install
cp config.example.js config.js
```

编辑 [`client/config.js`](/D:/Code/meem/client/config.js)：

```js
module.exports = {
    MEEM_URL: 'https://meem.example.workers.dev',
    SESSION_PASSWORD: '',
    BROWSER_CHANNEL: 'chrome',
    CHROME_EXTENSION_HOST: '127.0.0.1',
    CHROME_EXTENSION_PORT: '17373',
    MEEM_DEBUG: '0',
};
```

说明：

- `MEEM_URL`：你的 Worker 地址
- `SESSION_PASSWORD`：访问密码，可空
- `BROWSER_CHANNEL`：Playwright 使用的浏览器通道
- `CHROME_EXTENSION_HOST` / `CHROME_EXTENSION_PORT`：本地浏览器扩展 bridge 地址

启动：

```bash
npm start
```

启动后控制台会输出：

- 远程访问入口
- 会话密码
- 本地浏览器 bridge 地址

### 3. 加载 Chrome 扩展

打开 `chrome://extensions`：

1. 开启开发者模式
2. 选择 `Load unpacked`
3. 选择 [`chrome-extension/`](/D:/Code/meem/chrome-extension)

扩展会连接本地 `client/server/browser-extension` bridge。

### 4. 配置模型

进入 Meem 的 Agent 页面后，直接在设置里配置：

- Provider
- API URL
- API Key
- Model

这些配置由后端动态下发 provider catalog，并持久化到本机数据库。

---

## 开发

### Worker / Web 前端

```bash
cd worker
npm install
npm run dev:web
```

构建：

```bash
npm run build
```

### Client

```bash
cd client
npm install
npm start
```

### Chrome 扩展

修改 [`chrome-extension/`](/D:/Code/meem/chrome-extension) 后，去 `chrome://extensions` 点刷新。

---

## 当前状态

当前代码库已经完成这些关键迁移：

- `client` 从旧的单体 `agent` 结构迁移到 `agents / llm / server / apps`
- 主 agent 改成多 agent 委派模式
- 浏览器能力拆成“当前浏览器”与“Playwright”双路径
- provider 列表改成后端维护、前端动态读取

如果你继续往下开发，建议遵守两个原则：

1. 不要把业务能力直接塞进 `agents`
2. 不要在前端重复维护后端已经拥有的配置源

---

## License

[MIT](https://opensource.org/licenses/MIT)

// 工具定义：留在云端的只有 sql，其余都要发给设备执行。
import { SCHEMA_HINT } from './sql.js';

// 这些工具必须由设备执行，没有任何设备在线时不下发给模型。
export const DEVICE_TOOLS = new Set(['shell', 'read', 'write', 'edit', 'browser']);

// 每个设备工具都带 device：只有一台设备在线时可以不填，多台在线必须指定。
const deviceParam = {
  type: 'string',
  description: '执行设备的 id，设备清单见系统提示；只有一台设备在线时可以不填',
};

const deviceTools = [
  {
    type: 'function',
    name: 'shell',
    description: '在指定设备上执行终端命令并返回合并输出与退出码。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '终端命令' },
        workdir: { type: 'string', description: '可选工作目录' },
        device: deviceParam,
      },
      required: ['command'],
    },
  },
  {
    type: 'function',
    name: 'read',
    description: '读取指定设备上的带行号文本或图片。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        offset: { type: 'integer', description: '起始行，默认 1' },
        limit: { type: 'integer', description: '最多行数，默认 2000' },
        device: deviceParam,
      },
      required: ['path'],
    },
  },
  {
    type: 'function',
    name: 'write',
    description: '在指定设备上完整写入文件，自动创建父目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '完整内容' },
        device: deviceParam,
      },
      required: ['path', 'content'],
    },
  },
  {
    type: 'function',
    name: 'edit',
    description: '在指定设备上精确替换文本，默认要求唯一匹配。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        old_string: { type: 'string', description: '原文' },
        new_string: { type: 'string', description: '新内容' },
        replace_all: { type: 'boolean', description: '替换全部' },
        device: deviceParam,
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    type: 'function',
    name: 'browser',
    description: `控制指定设备上用户的浏览器（Chrome / Edge），能力等同开发者工具，所有标签页都能操作，包括用户自己打开、已经登录的页面。
- tabs 列出所有窗口的标签页，标出当前页和你打开的页
- open 打开网址（https、file 等）并等加载完：不带 tab 新开一个，放进以当前对话标题命名的标签组；带 tab 在那个标签页跳转
- close 关闭标签页；detach 断开对某个标签页的调试，顶部的“正在调试”提示会消失
- chrome 调用浏览器扩展接口：api 写成“命名空间.方法”，args 是参数数组。可用命名空间 tabs、windows、tabGroups、downloads、cookies、history、bookmarks、sessions、topSites。例如下载文件 api "downloads.download" args [{ url }]；读某站全部 cookie api "cookies.getAll" args [{ domain: "github.com" }]；查历史 api "history.search" args [{ text: "关键词", startTime: 0, maxResults: 20 }]；搜书签 api "bookmarks.search" args ["关键词"]；最近关闭 api "sessions.getRecentlyClosed" args [{}]
- cdp 对标签页发送 Chrome 开发者工具协议命令，method 是命令名，params 是参数。常用做法：
- 读文字：Runtime.evaluate { expression: "document.body.innerText", returnByValue: true }
- 执行 JS：Runtime.evaluate { expression, awaitPromise: true, returnByValue: true }
- 点击：先用 Runtime.evaluate 取元素 getBoundingClientRect 的中心，再依次发 Input.dispatchMouseEvent mouseMoved、mousePressed、mouseReleased（button: "left", clickCount: 1）
- 输入：先点击输入框，再 Input.insertText { text }
- 按键：Input.dispatchKeyEvent keyDown 和 keyUp（key、code、windowsVirtualKeyCode）
- 滚动：Input.dispatchMouseEvent { type: "mouseWheel", x, y, deltaX: 0, deltaY }
- 截图：Page.captureScreenshot { format: "png", clip: { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, scale: 1 / devicePixelRatio } }，这样图片坐标就是点击坐标；截图会作为图片交给你
点击或跳转后页面可能还在加载，需要时用 Runtime.evaluate 查 document.readyState。chrome:// 页面、应用商店和其他扩展的页面不能用 cdp。
在用户已登录的页面里操作就是以用户身份操作：提交表单、发消息、付款、删除这类撤不回的动作，先向用户确认。`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['tabs', 'open', 'close', 'detach', 'cdp', 'chrome'],
          description: 'tabs 列出所有标签页；open 打开网址（带 tab 则在该标签页跳转）；close 关闭标签页；detach 断开调试；cdp 发送 CDP 命令；chrome 调用扩展接口',
        },
        tab: { type: 'integer', description: '标签页编号，tabs 和 open 会给出' },
        url: { type: 'string', description: 'open 的网址' },
        method: { type: 'string', description: 'cdp 的命令名，如 Runtime.evaluate、Input.dispatchMouseEvent、Page.captureScreenshot' },
        params: { type: 'object', description: 'cdp 的命令参数' },
        api: { type: 'string', description: 'chrome 的接口，如 downloads.download、cookies.getAll、history.search' },
        args: {
          type: 'array',
          description: 'chrome 接口的参数列表，按顺序传给接口',
          items: { type: ['object', 'string', 'number', 'boolean', 'null'] },
        },
        device: deviceParam,
      },
      required: ['action'],
    },
  },
];

const sqlTool = {
  type: 'function',
  name: 'sql',
  description: `查询和修改 Roam 自己的数据库（SQLite / D1）：翻历史对话、统计用量、整理会话、清理数据都可以。一次一条语句，SELECT 最多返回 200 行且结果过大自动截断；INSERT / UPDATE / DELETE / CREATE 等写入会返回影响行数。支持 ? 占位符并在 params 里传值。\n\n${SCHEMA_HINT}`,
  parameters: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: '单条 SQL 语句（读或写都可以）' },
      params: {
        type: 'array',
        description: '按顺序替换 sql 里的 ? 占位符',
        items: { type: ['string', 'number', 'null'] },
      },
    },
    required: ['sql'],
  },
};

// 有设备在线才带上设备工具；全部离线时模型只知道 sql。
export function listTools({ anyOnline = false } = {}) {
  return anyOnline ? [...deviceTools, sqlTool] : [sqlTool];
}

function label(device) {
  return device.name || device.host || device.id;
}

// 给系统提示用的设备清单：每台一两行，标出在线状态。
export function describeDevices({ devices = [] } = {}) {
  if (!devices.length) return '还没有任何设备接入过。';
  const lines = devices.map((device) => {
    const parts = [
      `- ${label(device)}（id: ${device.id}）`,
      device.online ? '在线' : '离线',
    ];
    const env = [device.platform, device.arch].filter(Boolean).join('/');
    if (env) parts.push(env);
    if (device.username) parts.push(`用户 ${device.username}`);
    if (device.workdir) parts.push(`工作目录 ${device.workdir}`);
    parts.push(device.browser ? '浏览器插件已连接' : '浏览器插件未连接');
    let text = parts.join('，');
    if (device.description) text += `\n  ${device.description}`;
    return text;
  });
  return lines.join('\n');
}

// 给系统提示补一句当前处境，避免模型看不到设备时反复尝试。
export function describeAvailability({ devices = [], images = true } = {}) {
  const online = devices.filter((device) => device.online);
  if (!online.length) {
    return '所有设备当前都离线：只有 sql 工具可用，shell / read / write / edit / browser 都不可用，需要设备上的操作时如实说明并请用户连上设备。';
  }
  const note = images
    ? ''
    : '这个部署没有图片存储：read 读图片、browser 截图都拿不到图片内容，看网页时用 Runtime.evaluate 读文字和元素位置。';
  const names = online.map((device) => `「${label(device)}」`).join('、');
  const where = online.length === 1
    ? '只有这一台在线，设备工具不填 device 就在它上面执行。'
    : '有多台在线，调用设备工具必须在 device 里填设备 id；用户没说是哪台时按设备描述判断，判断不了就先问。';
  return `在线设备：${names}。${where}可以用 shell / read / write / edit / browser 操作设备，也可以用 sql 查自己的数据。${note}`;
}

export default { listTools, describeDevices, describeAvailability, DEVICE_TOOLS };

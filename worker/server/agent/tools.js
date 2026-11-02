// 工具定义：留在云端的只有 sql，其余都要发给设备执行。
import { SCHEMA_HINT } from './sql.js';

// 这些工具必须由设备执行，设备离线时不下发给模型。
export const DEVICE_TOOLS = new Set(['shell', 'read', 'write', 'edit', 'browser']);

const deviceTools = [
  {
    type: 'function',
    name: 'shell',
    description: '执行终端命令并返回合并输出与退出码。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '终端命令' },
        workdir: { type: 'string', description: '可选工作目录' },
      },
      required: ['command'],
    },
  },
  {
    type: 'function',
    name: 'read',
    description: '读取带行号文本或图片。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        offset: { type: 'integer', description: '起始行，默认 1' },
        limit: { type: 'integer', description: '最多行数，默认 2000' },
      },
      required: ['path'],
    },
  },
  {
    type: 'function',
    name: 'write',
    description: '完整写入文件，自动创建父目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '完整内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    type: 'function',
    name: 'edit',
    description: '精确替换文本，默认要求唯一匹配。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        old_string: { type: 'string', description: '原文' },
        new_string: { type: 'string', description: '新内容' },
        replace_all: { type: 'boolean', description: '替换全部' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    type: 'function',
    name: 'browser',
    description: `控制用户的浏览器（Chrome / Edge）。只能操作你用 open 打开的标签页，它们放在以当前对话标题命名的标签组里。
open 打开网页并等加载完；页面里的一切操作用 cdp 发送 Chrome 开发者工具协议命令，method 是命令名，params 是参数。常用做法：
- 读文字：Runtime.evaluate { expression: "document.body.innerText", returnByValue: true }
- 执行 JS：Runtime.evaluate { expression, awaitPromise: true, returnByValue: true }
- 点击：先用 Runtime.evaluate 取元素 getBoundingClientRect 的中心，再依次发 Input.dispatchMouseEvent mouseMoved、mousePressed、mouseReleased（button: "left", clickCount: 1）
- 输入：先点击输入框，再 Input.insertText { text }
- 按键：Input.dispatchKeyEvent keyDown 和 keyUp（key、code、windowsVirtualKeyCode）
- 滚动：Input.dispatchMouseEvent { type: "mouseWheel", x, y, deltaX: 0, deltaY }
- 截图：Page.captureScreenshot { format: "png", clip: { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, scale: 1 / devicePixelRatio } }，这样图片坐标就是点击坐标；截图会作为图片交给你
点击或跳转后页面可能还在加载，需要时用 Runtime.evaluate 查 document.readyState。`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['tabs', 'open', 'close', 'cdp'],
          description: 'tabs 列出已打开的标签页；open 打开网址（带 tab 则在该标签页跳转）；close 关闭标签页；cdp 发送 CDP 命令',
        },
        tab: { type: 'integer', description: '标签页编号，open 返回' },
        url: { type: 'string', description: 'open 的网址' },
        method: { type: 'string', description: 'cdp 的命令名，如 Runtime.evaluate、Input.dispatchMouseEvent、Page.captureScreenshot' },
        params: { type: 'object', description: 'cdp 的命令参数' },
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

// 设备在线才带上设备工具；离线时模型只知道 sql。
export function listTools({ deviceOnline = false } = {}) {
  return deviceOnline ? [...deviceTools, sqlTool] : [sqlTool];
}

// 给系统提示补一句当前处境，避免模型看不到设备时反复尝试。
export function describeAvailability({ deviceOnline = false, device = null, images = true } = {}) {
  if (deviceOnline) {
    const name = device?.name || device?.host || '设备';
    const note = images
      ? ''
      : '这个部署没有图片存储：read 读图片、browser 截图都拿不到图片内容，看网页时用 Runtime.evaluate 读文字和元素位置。';
    return `设备「${name}」已连接，可以用 shell / read / write / edit / browser 操作它，也可以用 sql 查自己的数据。${note}`;
  }
  return '设备当前离线：只有 sql 工具可用，shell / read / write / edit / browser 都不可用，需要设备上的操作时如实说明并请用户连上设备。';
}

export default { listTools, describeAvailability, DEVICE_TOOLS };

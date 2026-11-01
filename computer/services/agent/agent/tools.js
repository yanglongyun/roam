// 这里只放工具定义，执行代码在 functions 目录。
const tools = [
  {
    type: "function",
    name: "shell",
    description: "执行终端命令并返回合并输出与退出码。",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "终端命令",
        },
        workdir: {
          type: "string",
          description: "可选工作目录",
        },
      },
      required: ["command"],
    },
  },
  {
    type: "function",
    name: "read",
    description: "读取带行号文本或图片。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径",
        },
        offset: {
          type: "integer",
          description: "起始行，默认 1",
        },
        limit: {
          type: "integer",
          description: "最多行数，默认 2000",
        },
      },
      required: ["path"],
    },
  },
  {
    type: "function",
    name: "write",
    description: "完整写入文件，自动创建父目录。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径",
        },
        content: {
          type: "string",
          description: "完整内容",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    type: "function",
    name: "edit",
    description: "精确替换文本，默认要求唯一匹配。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径",
        },
        old_string: {
          type: "string",
          description: "原文",
        },
        new_string: {
          type: "string",
          description: "新内容",
        },
        replace_all: {
          type: "boolean",
          description: "替换全部",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    type: "function",
    name: "browser",
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
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["tabs", "open", "close", "cdp"],
          description:
            "tabs 列出已打开的标签页；open 打开网址（带 tab 则在该标签页跳转）；close 关闭标签页；cdp 发送 CDP 命令",
        },
        tab: {
          type: "integer",
          description: "标签页编号，open 返回",
        },
        url: {
          type: "string",
          description: "open 的网址",
        },
        method: {
          type: "string",
          description:
            "cdp 的命令名，如 Runtime.evaluate、Input.dispatchMouseEvent、Page.captureScreenshot",
        },
        params: {
          type: "object",
          description: "cdp 的命令参数",
        },
      },
      required: ["action"],
    },
  },
];

export default tools;

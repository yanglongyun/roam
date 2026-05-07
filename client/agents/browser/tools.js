export default [
    {
        type: 'function',
        function: {
            name: 'browser_status',
            description: '获取当前浏览器扩展桥接状态，以及最近活动标签页的信息。',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_open_tab',
            description: '在用户当前浏览器中打开一个新的标签页。',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string' },
                    timeoutSeconds: { type: 'integer' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_navigate',
            description: '让当前活动标签页跳转到指定地址。',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string' },
                    timeoutSeconds: { type: 'integer' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_eval',
            description: '在当前活动标签页的页面上下文中执行 JavaScript，并返回结果。',
            parameters: {
                type: 'object',
                properties: {
                    code: { type: 'string' },
                    timeoutSeconds: { type: 'integer' },
                },
                required: ['code'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_attach',
            description: '为当前活动标签页启用浏览器控制能力。',
            parameters: {
                type: 'object',
                properties: {
                    timeoutSeconds: { type: 'integer' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser_detach',
            description: '关闭当前活动标签页的浏览器控制能力。',
            parameters: {
                type: 'object',
                properties: {
                    timeoutSeconds: { type: 'integer' },
                },
            },
        },
    },
];

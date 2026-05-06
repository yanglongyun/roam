const tools = [
    {
        type: 'function',
        function: {
            name: 'terminal',
            description: '在本机执行一条终端命令并返回输出。',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string' },
                    cwd: { type: 'string' },
                    timeoutSeconds: { type: 'integer' },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'browser',
            description: '在本机有头浏览器里执行 Playwright 代码。code 应为 async (page, context, browser) => { ... }。',
            parameters: {
                type: 'object',
                properties: {
                    code: { type: 'string' },
                },
                required: ['code'],
            },
        },
    },
];

module.exports = { tools };

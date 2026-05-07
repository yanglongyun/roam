export default [
    {
        type: 'function',
        function: {
            name: 'playwright_run',
            description: '在独立受控浏览器中执行 Playwright 代码。code 必须是 async (page, context, browser) => { ... }。',
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

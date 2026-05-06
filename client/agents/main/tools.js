module.exports = [
    {
        type: 'function',
        function: {
            name: 'terminal',
            description: '在本机执行终端命令并返回输出。适合环境检查、命令执行、文件定位、进程排查等本机任务。',
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
            description: '把任务交给浏览器子 agent。它会复用用户当前正在使用的浏览器、当前标签页和当前登录状态来完成任务。',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string' },
                },
                required: ['task'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'playwright',
            description: '把任务交给 Playwright 子 agent。它会在独立受控浏览器中完成自动化，不依赖用户当前浏览器状态。',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string' },
                },
                required: ['task'],
            },
        },
    },
];

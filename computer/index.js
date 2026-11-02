import ws from './ws.js';
import router from './router.js';

import terminal from './services/terminal/index.js';
import agent from './services/agent/index.js';

async function boot() {
    console.log('🚀 正在启动 Roam Computer...');

    // 助理：只留工具执行和浏览器管道，对话与数据都在云端
    agent.start();

    await terminal.ensureDefault();

    ws.init({
        onOpen: () => {
            // 访问密码由云端校验；这里只要把自己是谁、有哪些终端告诉云端。
            agent.report();
            terminal.sendSnapshotAll();
        },
        onMessage: (msg) => router.dispatch(msg),
    });

    const stop = async () => {
        console.log('\n🛑 正在关闭 Roam Computer...');
        terminal.shutdown();
        await agent.shutdown().catch(() => {});
        ws.close();
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

boot().catch((err) => {
    console.error('❌ Roam Computer 启动失败:', err.message);
    process.exit(1);
});

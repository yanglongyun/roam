import ws from './ws.js';
import router from './router.js';

import guard from './services/guard/index.js';
import terminal from './services/terminal/index.js';
import agent from './services/agent/index.js';

async function boot() {
    console.log('🚀 正在启动 Roam Computer...');

    // 助理：本机数据库、配置，以及浏览器插件的本机管道
    agent.start();

    guard.bindOnGrant((clientId) => {
        terminal.sendSnapshotTo(clientId);
    });

    router.bindOnDevicesChanged((devices) => {
        if (devices?.web !== 'connected') return;
        console.log('🌐 网页端已接入当前会话');
        terminal.sendSnapshotAll();
        guard.sendAuthMode();
    });

    await terminal.ensureDefault();

    ws.init({
        onOpen: () => {
            guard.sendAuthMode();
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

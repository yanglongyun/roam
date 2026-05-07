import server from './server/index.js';

import guard from './apps/guard/index.js';
import terminal from './apps/terminal/index.js';

async function boot() {
    console.log('🚀 正在启动 Roam Client...');

    guard.bindOnGrant((clientId) => {
        terminal.sendSnapshotTo(clientId);
    });

    server.router.bindOnDevicesChanged((devices) => {
        if (devices?.web !== 'connected') return;
        console.log('🌐 网页端已接入当前会话');
        terminal.sendSnapshotAll();
        guard.sendAuthMode();
    });

    await terminal.ensureDefault();
    await server.browser.start();

    server.ws.init({
        onOpen: () => {
            guard.sendAuthMode();
            terminal.sendSnapshotAll();
        },
        onMessage: (msg) => server.router.dispatch(msg),
    });

    process.on('SIGINT', () => {
        console.log('\n🛑 正在关闭 Roam Client...');
        terminal.shutdown();
        server.ws.close();
        server.browser.stop().finally(() => process.exit(0));
    });
}

boot().catch((err) => {
    server.browser.stop().catch(() => {});
    console.error('❌ Roam Client 启动失败:', err.message);
    process.exit(1);
});

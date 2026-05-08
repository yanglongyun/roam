import ws from './ws.js';
import router from './router.js';

import guard from './services/guard/index.js';
import terminal from './services/terminal/index.js';

async function boot() {
    console.log('🚀 正在启动 Roam Server...');

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

    process.on('SIGINT', () => {
        console.log('\n🛑 正在关闭 Roam Server...');
        terminal.shutdown();
        ws.close();
        process.exit(0);
    });
}

boot().catch((err) => {
    console.error('❌ Roam Server 启动失败:', err.message);
    process.exit(1);
});

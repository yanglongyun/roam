const server = require('./server');

const guard = require('./apps/guard');
const terminal = require('./apps/terminal');
const agents = require('./agents');
const claudeCode = require('./apps/claude-code');

async function boot() {
    console.log('🚀 正在启动 Meem Client...');
    agents.ensureSession();

    guard.bindOnGrant((clientId) => {
        terminal.sendSnapshotTo(clientId);
        agents.sendConfig(`web:${clientId}`);
        agents.sendProviders(`web:${clientId}`);
        agents.sendSessions(`web:${clientId}`);
        agents.sendHistory(`web:${clientId}`);
        claudeCode.sendStatus(`web:${clientId}`);
        claudeCode.sendSessions(`web:${clientId}`);
    });

    server.router.bindOnDevicesChanged((devices) => {
        if (devices?.web !== 'connected') return;
        console.log('🌐 网页端已接入当前会话');
        terminal.sendSnapshotAll();
        agents.sendConfig('web');
        agents.sendProviders('web');
        agents.sendSessions('web');
        agents.sendHistory('web');
        guard.sendAuthMode();
        claudeCode.sendStatus('web');
        claudeCode.sendSessions('web');
    });

    await terminal.ensureDefault();
    await server.browserExtension.start();

    server.ws.init({
        onOpen: () => {
            guard.sendAuthMode();
            terminal.sendSnapshotAll();
            agents.sendConfig('web');
            agents.sendProviders('web');
        },
        onMessage: (msg) => server.router.dispatch(msg),
    });

    process.on('SIGINT', () => {
        console.log('\n🛑 正在关闭 Meem Client...');
        terminal.shutdown();
        server.ws.close();
        server.browserExtension.stop().finally(() => process.exit(0));
    });
}

boot().catch((err) => {
    server.browserExtension.stop().catch(() => {});
    console.error('❌ Meem Client 启动失败:', err.message);
    process.exit(1);
});

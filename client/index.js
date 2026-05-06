const ws = require('./core/ws');
const router = require('./core/router');

const guard = require('./guard');
const terminal = require('./terminal');
const agent = require('./agent');
const claudeCode = require('./claude-code');

async function boot() {
    // 预先初始化（没 db 的话会在这里创建文件）
    agent.ensureSession();

    // 新 web 认证通过后要推哪些快照？告诉 guard
    guard.bindOnGrant((clientId) => {
        terminal.sendSnapshotTo(clientId);
        agent.sendConfig(`web:${clientId}`);
        agent.sendSessions(`web:${clientId}`);
        agent.sendHistory(`web:${clientId}`);
        claudeCode.sendStatus(`web:${clientId}`);
        claudeCode.sendSessions(`web:${clientId}`);
    });

    // 有 web 端在线（先到或 reconnect 上来）时推一次全体快照
    router.bindOnDevicesChanged((devices) => {
        if (devices?.web === 'connected') {
            console.log('🌐 网页端已连接');
            terminal.sendSnapshotAll();
            agent.sendConfig('web');
            agent.sendSessions('web');
            agent.sendHistory('web');
            guard.sendAuthMode();
            claudeCode.sendStatus('web');
            claudeCode.sendSessions('web');
        }
    });

    // 桌面端启动就开一个默认终端，让用户打开就有东西用
    await terminal.ensureDefault();

    ws.init({
        onOpen: () => {
            guard.sendAuthMode();
            terminal.sendSnapshotAll();
            agent.sendConfig('web');
        },
        onMessage: (msg) => router.dispatch(msg),
    });

    process.on('SIGINT', () => {
        console.log('\n正在关闭...');
        terminal.shutdown();
        ws.close();
        process.exit(0);
    });
}

boot().catch((err) => {
    console.error('启动失败:', err.message);
    process.exit(1);
});

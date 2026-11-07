import { acquireInstance } from './core/single-instance.js';

async function boot() {
    const instance = acquireInstance();
    if (!instance.acquired) {
        console.log(`ℹ️ Roam Computer 已在运行${instance.pid ? `（进程 ${instance.pid}）` : ''}，无需重复启动。`);
        return;
    }
    process.once('exit', instance.release);
    console.log('🚀 正在启动 Roam Computer...');

    // 获得运行锁之后才能读取设备身份、启动终端、占用浏览器管道和连接云端。
    const [{ default: ws }, { default: router }, { default: terminal }, { default: agent }] = await Promise.all([
        import('./ws.js'), import('./router.js'), import('./services/terminal/index.js'), import('./services/agent/index.js'),
    ]);

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
        onClose: () => agent.cancelAll(),
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

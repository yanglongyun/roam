import ws from './ws.js';
import terminal from './services/terminal/index.js';
import files from './services/files/index.js';
import screen from './services/screen/index.js';
import status from './services/status/index.js';
import agent from './services/agent/index.js';

async function dispatch(message) {
    const t = message.type || '';

    if (t === 'connection.ping') {
        ws.send({ type: 'connection.pong', to: 'server', data: {} });
        return;
    }
    if (t === 'connection.ready' || t === 'connection.devices') return;

    // 有网页登录成功：把这台设备的终端快照单独发给它。
    if (t === 'web.joined') {
        const clientId = message.data?.clientId;
        if (clientId) {
            console.log('🌐 网页端已接入');
            terminal.sendSnapshotTo(clientId);
        }
        return;
    }

    if (t.startsWith('terminal.') || t.startsWith('data.') || t.startsWith('system.')) {
        if (await terminal.handle(message)) return;
    }
    if (t.startsWith('fs.')) {
        if (await files.handle(message)) return;
    }
    if (t.startsWith('screen.')) {
        if (await screen.handle(message)) return;
    }
    if (t.startsWith('status.')) {
        if (await status.handle(message)) return;
    }
    if (t === 'tool.call') {
        if (await agent.handle(message)) return;
    }

    console.log('未识别的消息类型:', t);
}

export { dispatch };
export default { dispatch };

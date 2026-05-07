import ws from './ws.js';
import guard from '../apps/guard/index.js';
import terminal from '../apps/terminal/index.js';
import files from '../apps/files/index.js';
import screen from '../apps/screen/index.js';
import agents from '../agents/index.js';

let onDevicesChanged = () => {};

function bindOnDevicesChanged(fn) {
    onDevicesChanged = fn;
}

async function dispatch(message) {
    const t = message.type || '';

    if (t === 'connection.ping') {
        ws.send({ type: 'connection.pong', to: 'server', data: {} });
        return;
    }
    if (t === 'connection.devices') {
        onDevicesChanged(message.data?.devices);
        return;
    }
    if (t === 'connection.ready') return;

    if (t.startsWith('auth.')) {
        if (await guard.handle(message)) return;
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
    if (t.startsWith('agent.')) {
        if (await agents.handle(message)) return;
    }

    console.log('未识别的消息类型:', t);
}

export { dispatch, bindOnDevicesChanged };
export default { dispatch, bindOnDevicesChanged };

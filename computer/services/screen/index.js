import ws from '../../ws.js';
import { captureCompressed } from '../../core/screenshot.js';

async function capture(reqId) {
    const shot = await captureCompressed();
    ws.broadcast('screen.capture.result', {
        reqId,
        ok: true,
        mime: shot.mime,
        capturedAt: Date.now(),
        bytes: shot.buffer.length,
        data: shot.buffer.toString('base64'),
    });
}

async function handle(message) {
    const t = message.type;
    const d = message.data || {};
    const reqId = d.reqId;

    try {
        switch (t) {
            case 'screen.capture':
                await capture(reqId);
                return true;
            default:
                ws.broadcast('screen.capture.result', { reqId, ok: false, error: `未知 screen 操作: ${t}` });
                return true;
        }
    } catch (err) {
        console.error(`screen 错误 [${t}]:`, err.message || err);
        ws.broadcast('screen.capture.result', { reqId, ok: false, error: err.message || String(err) });
        return true;
    }
}

export { handle };
export default { handle };

import ws from '../../ws.js';
import { captureCompressed } from '../../core/screenshot.js';
import { createScreenService } from './session.js';

let native;
async function mac() { return native ||= await import('../../core/mac-screen-control.js'); }
const unsupported = () => { throw Object.assign(new Error('当前设备暂不支持远程操作'), { code: 'CONTROL_UNSUPPORTED' }); };
const driver = {
    display: async () => process.platform === 'darwin' ? (await mac()).screenDisplay() : null,
    status: async () => process.platform === 'darwin' ? (await mac()).controlStatus() : { supported: false, allowed: false, platform: process.platform },
    input: async (input, display) => process.platform === 'darwin' ? (await mac()).applyInput(input, display) : unsupported(),
    permission: async () => process.platform === 'darwin' ? (await mac()).requestControlPermission() : unsupported(),
};
const service = createScreenService({ capture: captureCompressed, driver,
    send: (client, result) => ws.sendToClient(client, 'screen.result', result),
});
export const handle = service.handle;
export const releaseClient = service.releaseClient;
export const perform = service.perform;
export default { handle, releaseClient, perform };

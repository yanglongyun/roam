import { SERVER_URL, WEB_URL, DEVICE_TOKEN, DEBUG } from './core/env.js';
import { deviceId } from './core/device.js';
import { createConnection } from './core/connection.js';

const connection = createConnection({ serverUrl: SERVER_URL, webUrl: WEB_URL, token: DEVICE_TOKEN, id: deviceId(), debug: DEBUG });
export const { init, send, sendToClient, broadcast, close, getDeviceId } = connection;
export default connection;

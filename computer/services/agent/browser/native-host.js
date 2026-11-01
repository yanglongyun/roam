// 原生消息宿主:浏览器插件需要时由 Chrome / Edge 启动,只做转发。
//   浏览器那头是标准输入输出,每条消息前 4 字节小端长度,后面是 JSON;
//   电脑端那头是本机管道(地址在 ROAM_BROWSER_SOCKET),每行一个 JSON。
// 电脑端没在运行就直接退出,插件稍后重试。
import net from 'node:net';

const socket = net.connect(process.env.ROAM_BROWSER_SOCKET || '');
socket.on('error', () => process.exit(1));
socket.on('close', () => process.exit(0));

// 浏览器 → 电脑端
let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 4) {
        const size = input.readUInt32LE(0);
        if (input.length < 4 + size) break;
        socket.write(`${input.subarray(4, 4 + size).toString('utf8')}\n`);
        input = input.subarray(4 + size);
    }
});
process.stdin.on('end', () => process.exit(0));

// 电脑端 → 浏览器
let text = '';
socket.setEncoding('utf8');
socket.on('data', (chunk) => {
    text += chunk;
    let index = text.indexOf('\n');
    while (index >= 0) {
        const body = Buffer.from(text.slice(0, index), 'utf8');
        text = text.slice(index + 1);
        const head = Buffer.alloc(4);
        head.writeUInt32LE(body.length);
        process.stdout.write(Buffer.concat([head, body]));
        index = text.indexOf('\n');
    }
});

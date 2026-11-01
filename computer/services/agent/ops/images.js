// 图片：上传（Data URL）存成文件；按地址读回给网页显示。图片只在电脑端存一份。
import { readImage, saveImage } from '../images.js';
import { fail, pick, requireSession } from './util.js';

export async function upload(context, args) {
    const { id, image } = pick(args, ['id', 'image']);
    requireSession(context.db, id);
    if (typeof image !== 'string') {
        fail(400, '图片必须是 Data URL');
    }
    const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match) {
        fail(400, '仅支持 PNG、JPEG、GIF、WebP 图片');
    }
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 10 * 1024 * 1024) {
        fail(413, '每张图片不能超过 10 MiB');
    }
    let type;
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        type = 'png';
    } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
        type = 'jpeg';
    } else if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
        type = 'gif';
    } else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
        type = 'webp';
    }
    if (type !== match[1] || bytes.toString('base64') !== match[2]) {
        fail(400, '图片内容或编码无效');
    }
    const url = await saveImage(context.paths.images, bytes, `.${type}`);
    return { url };
}

// 消息里的图片地址是 /api/images/<文件名>；网页没法直接访问电脑，经这里取回 base64。
export async function get(context, args) {
    const { url } = pick(args, ['url']);
    if (typeof url !== 'string' || !url.startsWith('/api/images/')) {
        fail(400, '图片地址无效');
    }
    try {
        const image = await readImage(context.paths.images, url.slice('/api/images/'.length));
        return { type: image.type, data: image.bytes.toString('base64') };
    } catch (error) {
        if (error.code === 'ENOENT') {
            fail(404, '图片不存在');
        }
        throw error;
    }
}

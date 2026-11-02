// 图片：本体进 R2（键 images/<id>.<ext>），元信息进 D1 的 images 表。
// 对外地址沿用 /api/images/<name>，前端和模型侧都不用改。
// R2 是可选的：开通要绑卡，没绑就不收发图片，其余功能照常。
import { all, one, run } from './db.js';
import { toBase64 } from './crypto.js';

const TYPES = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const NAME = /^[a-f0-9-]{36}\.(?:png|jpeg|gif|webp)$/;

export function imagesEnabled(env) {
  return Boolean(env.IMAGES);
}

export function urlOf(name) {
  return `/api/images/${name}`;
}

export function nameOf(url) {
  if (typeof url !== 'string' || !url.startsWith('/api/images/')) return null;
  const name = url.slice('/api/images/'.length);
  return NAME.test(name) ? name : null;
}

function typeOf(name) {
  return TYPES[name.slice(name.lastIndexOf('.') + 1)] || 'application/octet-stream';
}

export async function saveImage(env, { bytes, mime, sessionId }) {
  if (!imagesEnabled(env)) {
    const error = new Error('没有绑定 R2，不能发送图片');
    error.status = 400;
    throw error;
  }
  const ext = Object.keys(TYPES).find((key) => TYPES[key] === mime);
  if (!ext) {
    const error = new Error('只支持 PNG / JPEG / GIF / WebP 图片');
    error.status = 400;
    throw error;
  }
  const name = `${crypto.randomUUID()}.${ext}`;
  const now = Date.now();
  await env.IMAGES.put(`images/${name}`, bytes, {
    httpMetadata: { contentType: mime },
  });
  await run(
    env,
    'INSERT INTO images (id, session_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?)',
    [name, sessionId || null, mime, bytes.byteLength, now],
  );
  return { name, url: urlOf(name), size: bytes.byteLength, type: mime };
}

export async function readImage(env, name) {
  if (!NAME.test(name)) {
    const error = new Error('图片地址无效');
    error.status = 400;
    throw error;
  }
  if (!imagesEnabled(env)) {
    const error = new Error('没有绑定 R2，图片不可用');
    error.status = 404;
    throw error;
  }
  const object = await env.IMAGES.get(`images/${name}`);
  if (!object) {
    const error = new Error('图片不存在');
    error.status = 404;
    throw error;
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  return { bytes, type: object.httpMetadata?.contentType || typeOf(name) };
}

// 模型请求里把 /api/images/xxx 换成 data URL；原消息和事件仍然保留短地址。
export async function dataUrl(env, name) {
  const image = await readImage(env, name);
  return `data:${image.type};base64,${toBase64(image.bytes)}`;
}

export async function deleteImages(env, names) {
  const unique = [...new Set(names.filter((name) => NAME.test(name)))];
  if (!unique.length) return;
  if (imagesEnabled(env)) {
    await env.IMAGES.delete(unique.map((name) => `images/${name}`));
  }
  await env.DB.batch(
    unique.map((name) => env.DB.prepare('DELETE FROM images WHERE id = ?').bind(name)),
  );
}

export async function exists(env, name) {
  return Boolean(await one(env, 'SELECT id FROM images WHERE id = ?', [name]));
}

export async function sessionImages(env, sessionId) {
  const rows = await all(env, 'SELECT id FROM images WHERE session_id = ?', [sessionId]);
  return rows.map((row) => row.id);
}

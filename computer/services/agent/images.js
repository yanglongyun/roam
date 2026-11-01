import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const imageTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function saveImage(directory, bytes, extension, signal) {
  const name = randomUUID() + extension;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(path.join(directory, name), bytes, { mode: 0o600, signal });
  } catch (error) {
    await fs.rm(path.join(directory, name), { force: true });
    throw error;
  }
  return `/api/images/${name}`;
}

export async function readImage(directory, name, signal) {
  // 图片地址只能指向图片目录中的 UUID 文件，不能传入任意文件路径。
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/.test(
      name,
    )
  ) {
    const error = new Error("图片地址无效");
    error.code = "ENOENT";
    throw error;
  }
  const bytes = await fs.readFile(path.join(directory, name), { signal });
  return { type: imageTypes[path.extname(name)], bytes };
}

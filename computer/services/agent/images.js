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

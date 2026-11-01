import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { imageTypes, saveImage } from "../../images.js";

export default async function read(args, config, signal) {
  if (typeof args.path !== "string" || !args.path) {
    throw new Error("缺少 path");
  }
  for (const key of ["offset", "limit"]) {
    if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || args[key] < 1)) {
      throw new Error(`${key} 必须是正整数`);
    }
  }
  const filename = path.resolve(config.workdir || os.homedir(), args.path);
  const info = await fs.stat(filename);
  if (!info.isFile()) {
    throw new Error("不是普通文件，请用 shell 查看");
  }
  const extension = path.extname(filename).toLowerCase();
  const type = imageTypes[extension];
  if (info.size > (type ? 5 : 32) * 1024 * 1024) {
    throw new Error("文件过大，请用 shell 处理");
  }
  const bytes = await fs.readFile(filename, { signal });
  if (type) {
    const imageURL = await saveImage(config.images_dir, bytes, extension, signal);
    config.run_images?.add(imageURL);
    return { text: `已读取图片 ${args.path}`, imageURL };
  }
  if (bytes.includes(0)) {
    throw new Error("这是二进制文件");
  }
  const lines = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/\r\n/g, "\n")
    .split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const start = (args.offset ?? 1) - 1;
  const limit = args.limit ?? 2000;
  let text =
    lines
      .slice(start, start + limit)
      .map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`)
      .join("\n") + `\n\n[共 ${lines.length} 行]`;
  if (text.length > config.max_output) {
    text = text.slice(0, config.max_output) + "\n…（输出已截断）";
  }
  return { text };
}

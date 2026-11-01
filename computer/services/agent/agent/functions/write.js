import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

export default async function write(args, config, signal) {
  if (typeof args.path !== "string" || !args.path || typeof args.content !== "string") {
    throw new Error("缺少 path 或 content");
  }
  const filename = path.resolve(config.workdir || os.homedir(), args.path);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  signal?.throwIfAborted();
  await fs.writeFile(filename, args.content, { signal });
  return {
    text: `已写入 ${args.path}（${Buffer.byteLength(args.content)} 字节）`,
  };
}

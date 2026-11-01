import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

export default async function edit(args, config, signal) {
  if (
    typeof args.path !== "string" ||
    !args.path ||
    typeof args.old_string !== "string" ||
    !args.old_string ||
    typeof args.new_string !== "string"
  ) {
    throw new Error("缺少参数或 old_string 为空");
  }
  const filename = path.resolve(config.workdir || os.homedir(), args.path);
  const info = await fs.stat(filename);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) {
    throw new Error("不是普通文件或超过 2MB");
  }
  const content = await fs.readFile(filename, { encoding: "utf8", signal });
  const count = content.split(args.old_string).length - 1;
  if (!count) {
    throw new Error("没有找到 old_string");
  }
  if (count > 1 && !args.replace_all) {
    throw new Error(`匹配到 ${count} 处，请增加上下文或设置 replace_all`);
  }
  signal?.throwIfAborted();
  const next = args.replace_all
    ? content.split(args.old_string).join(args.new_string)
    : content.replace(args.old_string, () => args.new_string);
  await fs.writeFile(filename, next, { signal });
  return {
    text: `已修改 ${args.path}（替换 ${args.replace_all ? count : 1} 处）`,
  };
}

import { readImage } from "../images.js";

// 只替换本次请求中的图片地址，原消息和事件始终保留本地文件地址。
export default async function prepareImages(messages, directory, signal) {
  const input = [];
  for (const item of messages) {
    let parts = item.content;
    if (item.type === "function_call_output") {
      parts = item.output;
    }
    if (
      !Array.isArray(parts) ||
      !parts.some(
        (part) => part.type === "input_image" && part.image_url?.startsWith("/api/images/"),
      )
    ) {
      input.push(item);
      continue;
    }
    const content = [];
    for (const part of parts) {
      if (part.type === "input_image" && part.image_url?.startsWith("/api/images/")) {
        const name = part.image_url.slice("/api/images/".length);
        const image = await readImage(directory, name, signal);
        content.push({
          ...part,
          image_url: `data:${image.type};base64,${image.bytes.toString("base64")}`,
        });
      } else {
        content.push(part);
      }
    }
    if (item.type === "function_call_output") {
      input.push({ ...item, output: content });
    } else {
      input.push({ ...item, content });
    }
  }
  return input;
}

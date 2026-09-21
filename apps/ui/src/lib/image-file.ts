/** 常见图片扩展名判定：消息图片、文件浏览器、预览面板共用 */

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico",
]);

/** 去掉 file:// 前缀与查询串，取小写扩展名 */
function extensionOf(path: string): string {
  const clean = path.replace(/^file:\/\//i, "").split(/[?#]/)[0] ?? "";
  const name = clean.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return name.slice(dot + 1).toLowerCase();
}

/** 是否为可预览的图片文件 */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

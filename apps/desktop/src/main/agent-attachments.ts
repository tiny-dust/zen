import type { AttachmentRef } from "@zen/shared";

/**
 * 模型侧消息的附件路径清单注入：
 * 正文里的 `$名称` 引用对模型只是一段文本（渲染层才有附件元数据），
 * 不注入路径清单的话 Agent 只能在工作区里瞎找——上传文件几乎必然
 * 位于工作区之外（选择/拖放保留原路径，粘贴落 ~/.zen/cache）。
 *
 * 只改发给模型的 userMessage（同 withImageAnalysisText 的模式），
 * 落库与渲染层气泡仍展示用户原文。
 */
export function withAttachmentManifest(
  base: string,
  attachments: AttachmentRef[] | undefined,
): string {
  if (!attachments?.length) {
    return base;
  }
  const lines = attachments.map((att) => {
    if (att.path) {
      return `- $${att.name} → ${att.path}`;
    }
    return `- $${att.name} →（该文件未落盘，无法按路径读取）`;
  });
  return [
    base,
    "",
    "<attachments>",
    "用户随本条消息上传了以下文件（正文中的 $名称 引用即对应清单项）：",
    ...lines,
    "可用 readFile/listDir 等工具按上面的绝对路径直接读取；路径可能位于当前工作区之外。",
    "</attachments>",
  ].join("\n");
}

import type { BrowserElementRef } from "@zen/shared";
import { formatElementForPrompt } from "./selectors";

/** 把正文里的 `$el:标签` 展开为完整元素描述（main 侧历史构建用；与 ui 侧 expandBrowserElementTokens 同构） */
export function expandElementTokens(
  text: string,
  marks: Array<{ token: string; ref: BrowserElementRef }>,
): string {
  if (!marks.length) return text;
  let out = text;
  for (const mark of marks) {
    if (!mark?.token || !mark.ref || !out.includes(mark.token)) continue;
    out = out.split(mark.token).join(formatElementForPrompt(mark.ref));
  }
  return out;
}

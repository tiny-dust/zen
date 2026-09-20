import type { BrowserElementRef } from "@zen/shared";
import { useRightPanelStore } from "@/stores/right-panel";

/** composer 内的页面元素引用：正文里以 `$el:<id>` 链接形式存在 */
export interface ComposerElementMark {
  id: string;
  /** 展示名（短） */
  label: string;
  /** 正文 token，如 `$el:be_xxx` */
  token: string;
  ref: BrowserElementRef;
}

export function elementLabel(ref: BrowserElementRef): string {
  const text = (ref.text || ref.ariaLabel || ref.placeholder || "").trim().replace(/\s+/g, " ");
  if (text) {
    return text.length > 16 ? `${text.slice(0, 16)}…` : text;
  }
  if (ref.id) {
    return `#${ref.id}`;
  }
  return ref.tag || "元素";
}

export function elementToken(label: string): string {
  // 输入框内以可读 tag 形式存在：`$el:登录`，而不是内部 id
  return `$el:${label}`;
}

export function createElementMark(ref: BrowserElementRef, seq: number, usedLabels: Set<string>): ComposerElementMark {
  const id = `be_${seq}`;
  let label = elementLabel(ref);
  // 同名元素加序号，保证 token 唯一
  if (usedLabels.has(label)) {
    let n = 2;
    while (usedLabels.has(`${label}${n}`)) {
      n += 1;
    }
    label = `${label}${n}`;
  }
  usedLabels.add(label);
  return {
    id,
    label,
    token: elementToken(label),
    ref,
  };
}

/** 给 Agent 的完整结构化描述 */
export function formatElementForPrompt(ref: BrowserElementRef): string {
  const bits = [`selector=\`${ref.selector}\``, `tag=${ref.tag}`];
  if (ref.id) bits.push(`id=${ref.id}`);
  if (ref.text) bits.push(`text="${ref.text}"`);
  if (ref.ariaLabel) bits.push(`aria-label="${ref.ariaLabel}"`);
  if (ref.placeholder) bits.push(`placeholder="${ref.placeholder}"`);
  if (ref.role) bits.push(`role=${ref.role}`);
  bits.push(`rect=${ref.rect.width}x${ref.rect.height}@(${ref.rect.x},${ref.rect.y})`);
  bits.push(`page=${ref.pageUrl}`);
  return `[页面元素] ${bits.join(" ")}`;
}

/** tooltip / 悬浮卡明细 */
export function formatElementDetail(ref: BrowserElementRef): string {
  const lines = [
    `选择器：${ref.selector}`,
    `标签：${ref.tag}${ref.id ? ` #${ref.id}` : ""}`,
  ];
  if (ref.text) lines.push(`文本：${ref.text}`);
  if (ref.ariaLabel) lines.push(`aria-label：${ref.ariaLabel}`);
  if (ref.placeholder) lines.push(`placeholder：${ref.placeholder}`);
  if (ref.name) lines.push(`name：${ref.name}`);
  if (ref.role) lines.push(`role：${ref.role}`);
  lines.push(`位置：${ref.rect.width}×${ref.rect.height} @ (${ref.rect.x}, ${ref.rect.y})`);
  lines.push(`页面：${ref.pageUrl}`);
  return lines.join("\n");
}

/** 发送给 Agent 时展开正文里的 `$el:id` 为完整描述 */
export function expandBrowserElementTokens(
  text: string,
  marks: ComposerElementMark[],
): string {
  if (!marks.length) {
    return text;
  }
  let out = text;
  for (const mark of marks) {
    if (!out.includes(mark.token)) {
      continue;
    }
    out = out.split(mark.token).join(formatElementForPrompt(mark.ref));
  }
  return out;
}

export const ELEMENT_TOKEN_RE = /\$el:[^\s$]+/g;

/** 全局：http(s) 链接统一走应用内右栏浏览器 */
export async function openAppLink(url: string): Promise<void> {
  const { useBrowserStore } = await import("@/stores/browser");
  const browser = useBrowserStore();
  const right = useRightPanelStore();
  right.ensureTab("browser");
  await browser.openUrl(url);
}


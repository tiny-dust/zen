/**
 * 快捷键展示工具：把 "Shift+Cmd+P" 这类组合键拆成逐键片段供 <Kbd> 渲染。
 * 修饰键符号按平台：macOS 用 ⌘⌃⌥⇧，Windows/Linux 保留 Ctrl/Alt/Shift 文字
 * （三平台可运行铁律：快捷键说明不得只按 macOS 编写）。
 */

const MAC_SYMBOLS: Record<string, string> = {
  Cmd: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

/** 回车键统一用符号，三平台一致 */
const COMMON_SYMBOLS: Record<string, string> = {
  Enter: "↵",
};

/** 当前是否 macOS：优先用 preload 的同步平台标识，拿不到时退回 UA 探测 */
export function isMacPlatform(): boolean {
  const platform = window.zen?.window.getPlatform?.();
  if (platform) {
    return platform === "darwin";
  }
  return /Mac|iP(hone|ad|od)/.test(navigator.userAgent);
}

/** "Shift+Cmd+P" → ["Shift", "Cmd", "P"] */
export function shortcutKeyParts(key: string): string[] {
  return key.split("+").filter(Boolean);
}

/** 单键展示文案：macOS 修饰键用符号，其余平台 Cmd 按主修饰键 Ctrl 展示（回车统一 ↵） */
export function shortcutKeyLabel(part: string): string {
  if (isMacPlatform()) {
    return MAC_SYMBOLS[part] ?? COMMON_SYMBOLS[part] ?? part;
  }
  return COMMON_SYMBOLS[part] ?? (part === "Cmd" ? "Ctrl" : part);
}

/** 组合键逐键展示片段：shortcutDisplayParts("Shift+Cmd+P") → ["⇧", "⌘", "P"]（macOS） */
export function shortcutDisplayParts(key: string): string[] {
  return shortcutKeyParts(key).map(shortcutKeyLabel);
}

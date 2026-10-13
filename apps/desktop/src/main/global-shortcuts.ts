import { BrowserWindow, globalShortcut } from "electron";

import type { ShortcutBinding } from "@zen/shared";
import { GLOBAL_SHORTCUT_COMMANDS } from "@zen/shared";

/**
 * 应用级（系统全局）快捷键注册：
 * - 绑定存 ShortcutBinding.global（仅 GLOBAL_SHORTCUT_COMMANDS 白名单命令可开）；
 * - 默认键位统一 "Cmd+..."（macOS 写法），注册到 Electron accelerator 时
 *   Cmd → CmdOrCtrl：macOS 上是 ⌘，Windows/Linux 上按主修饰键 Ctrl 匹配，
 *   与渲染层 useGlobalShortcuts 的平台归一规则一致（三平台铁律）；
 * - 触发时把主窗口拉到前台并广播 shortcut:global 命令给渲染层执行。
 */

/** 渲染层 shortcut 写法 → Electron accelerator 写法；无法转换时返回 null */
export function shortcutToAccelerator(key: string): string | null {
  const parts = key
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return null;
  }
  const out: string[] = [];
  let hasModifier = false;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "cmd" || lower === "command" || lower === "meta") {
      out.push("CmdOrCtrl");
      hasModifier = true;
      continue;
    }
    if (lower === "ctrl" || lower === "control") {
      out.push("Control");
      hasModifier = true;
      continue;
    }
    if (lower === "alt" || lower === "option") {
      out.push("Alt");
      hasModifier = true;
      continue;
    }
    if (lower === "shift") {
      out.push("Shift");
      hasModifier = true;
      continue;
    }
    // 非修饰键只允许出现一次
    if (out.some((item) => !item.includes("Or") && !["Control", "Alt", "Shift"].includes(item))) {
      return null;
    }
    if (part.length === 1) {
      out.push(part.toUpperCase());
      continue;
    }
    // 多字符键映射到 accelerator 规范写法
    const keyMap: Record<string, string> = {
      Enter: "Return",
      Space: "Space",
      Escape: "Escape",
      Tab: "Tab",
      Up: "Up",
      Down: "Down",
      Left: "Left",
      Right: "Right",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Home: "Home",
      End: "End",
      Backspace: "Backspace",
      Delete: "Delete",
    };
    out.push(keyMap[part] ?? part);
  }
  // 全局快捷键必须是组合键：裸键会吞掉系统单键输入，拒绝注册
  if (!hasModifier) {
    return null;
  }
  return out.join("+");
}

/** 收集一次同步中注册失败的条目（key + 原因），调用方可用于日志/提示 */
export function syncGlobalShortcuts(shortcuts: ShortcutBinding[]): Array<{ key: string; error: string }> {
  const failures: Array<{ key: string; error: string }> = [];
  globalShortcut.unregisterAll();
  const seen = new Set<string>();
  for (const item of shortcuts) {
    if (!item.global || !GLOBAL_SHORTCUT_COMMANDS.has(item.command)) {
      continue;
    }
    const accelerator = shortcutToAccelerator(item.key);
    if (!accelerator || seen.has(accelerator)) {
      continue;
    }
    seen.add(accelerator);
    try {
      globalShortcut.register(accelerator, () => {
        triggerGlobalCommand(item.command);
      });
    } catch (error) {
      failures.push({ key: item.key, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return failures;
}

/** 全局快捷键触发：拉起主窗口（三平台行为一致）并广播给渲染层执行命令 */
function triggerGlobalCommand(command: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) {
      continue;
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    win.webContents.send("shortcut:global", command);
    // 只发给第一个可用窗口，避免多窗口时命令重复执行
    break;
  }
}

/** app 退出前清理（will-quit 里调用；Electron 也会自动注销，这里显式收尾） */
export function unregisterAllGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}

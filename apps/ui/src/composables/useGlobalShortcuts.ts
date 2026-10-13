import { onMounted, onUnmounted } from "vue";

import type { ShortcutBinding } from "@zen/shared";
import { shortcutMatches } from "@zen/shared";
import { isMacPlatform } from "@/lib/shortcut-display";

interface GlobalShortcutsOptions {
  shortcuts: () => ShortcutBinding[];
  onCommand: (command: string, event: KeyboardEvent) => void;
}

function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

/**
 * 平台归一匹配：默认快捷键统一存 "Cmd+..."（macOS 写法），
 * Windows/Linux 没有 ⌘（Meta 是 Win 键），Cmd 绑定按主修饰键 Ctrl 匹配。
 * 三平台共用 shared 里同一份默认绑定，平台差异在 UI 层补齐。
 */
function bindingMatches(event: KeyboardEvent, key: string): boolean {
  const matchKey = isMacPlatform()
    ? key
    : key
        .split("+")
        .map((part) => (part === "Cmd" ? "Ctrl" : part))
        .join("+");
  return shortcutMatches(event, matchKey);
}

export function useGlobalShortcuts({ shortcuts, onCommand }: GlobalShortcutsOptions) {
  function onKeydown(event: KeyboardEvent) {
    // 裸键（Enter、字母等）永远交给焦点元素：按钮回车、下拉选择、输入框都依赖默认行为。
    // 全局快捷键只认带修饰键的组合——裸 Enter 曾被「发送消息」绑定吞掉，
    // 导致确认弹窗里的 Enter 无法激活按钮（Electron 与浏览器表现一致，务必保持此规则）。
    if (!hasCommandModifier(event)) {
      return;
    }
    const binding = shortcuts().find((item) => bindingMatches(event, item.key));
    if (!binding) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onCommand(binding.command, event);
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onKeydown));
}

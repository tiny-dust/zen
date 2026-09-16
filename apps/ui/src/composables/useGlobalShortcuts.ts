import { onMounted, onUnmounted } from "vue";

import type { ShortcutBinding } from "@zen/shared";
import { shortcutMatches } from "@zen/shared";

interface GlobalShortcutsOptions {
  shortcuts: () => ShortcutBinding[];
  onCommand: (command: string, event: KeyboardEvent) => void;
}

function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

export function useGlobalShortcuts({ shortcuts, onCommand }: GlobalShortcutsOptions) {
  function onKeydown(event: KeyboardEvent) {
    // 裸键（Enter、字母等）永远交给焦点元素：按钮回车、下拉选择、输入框都依赖默认行为。
    // 全局快捷键只认带修饰键的组合——裸 Enter 曾被「发送消息」绑定吞掉，
    // 导致确认弹窗里的 Enter 无法激活按钮（Electron 与浏览器表现一致，务必保持此规则）。
    if (!hasCommandModifier(event)) {
      return;
    }
    const binding = shortcuts().find((item) => shortcutMatches(event, item.key));
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

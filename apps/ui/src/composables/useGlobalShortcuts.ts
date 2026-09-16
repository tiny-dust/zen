import { onMounted, onUnmounted } from "vue";

import type { ShortcutBinding } from "@zen/shared";
import { shortcutMatches } from "@zen/shared";

interface GlobalShortcutsOptions {
  shortcuts: () => ShortcutBinding[];
  onCommand: (command: string, event: KeyboardEvent) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.isContentEditable || element?.closest("input, textarea, select"));
}

function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

export function useGlobalShortcuts({ shortcuts, onCommand }: GlobalShortcutsOptions) {
  function onKeydown(event: KeyboardEvent) {
    // 输入框内只放行带修饰键的组合，裸键让位给输入框自身。
    if (isEditableTarget(event.target) && !hasCommandModifier(event)) {
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

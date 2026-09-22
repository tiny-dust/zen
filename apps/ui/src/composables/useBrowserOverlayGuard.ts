import { onUnmounted, toValue, watch } from "vue";

import { useBrowserStore } from "@/stores/browser";

import type { MaybeRefOrGetter } from "vue";

/**
 * HTML 弹窗打开期间压制内嵌浏览器原生视图：
 * WebContentsView 挂在窗口 contentView 上，层级高于渲染层一切 HTML，
 * 不隐藏会盖住居中弹窗（技能/MCP 等）。弹窗关闭或组件卸载时自动恢复。
 */
export function useBrowserOverlayGuard(isOpen: MaybeRefOrGetter<boolean>): void {
  const browser = useBrowserStore();
  let active = false;

  watch(
    () => toValue(isOpen),
    (open) => {
      if (open && !active) {
        active = true;
        browser.beginOverlay();
        return;
      }
      if (!open && active) {
        active = false;
        browser.endOverlay();
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    if (active) {
      active = false;
      browser.endOverlay();
    }
  });
}

import { onBeforeUnmount, toValue, watch } from "vue";

import { useBrowserStore } from "@/stores/browser";

import type { MaybeRefOrGetter } from "vue";

/** 弹层根元素：DOM 元素，或暴露 $el 的组件实例（reka-ui Content 原语均转发），关闭/卸载时为 null */
export type OverlayElement = HTMLElement | { $el?: unknown } | null;
export type OverlayElementSource = MaybeRefOrGetter<OverlayElement>;

function resolveElement(source: OverlayElementSource): HTMLElement | null {
  const raw = toValue(source);
  if (!raw) {
    return null;
  }
  if (raw instanceof HTMLElement) {
    return raw;
  }
  const el = (raw as { $el?: unknown }).$el;
  return el instanceof HTMLElement ? el : null;
}

/**
 * shadcn-vue 弹层原语（Dialog / Popover / DropdownMenu / HoverCard / Select /
 * ContextMenu 的 Content）的几何感知守卫：
 * 弹层元素挂载后测自身 getBoundingClientRect，与内嵌浏览器 viewRect 相交才
 * beginOverlay 压制原生 WebContentsView；不相交不隐藏（避免无谓闪烁）。
 * 元素卸载/关闭（source 变 null）或不再相交时 endOverlay。
 * 与手动 useBrowserOverlayGuard 共用 beginOverlay/endOverlay 计数制，可叠加。
 */
export function useOverlayGeometry(source: OverlayElementSource): void {
  const browser = useBrowserStore();
  let active = false;
  let element: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;
  let frame = 0;

  function intersects(): boolean {
    const viewRect = browser.viewRect;
    if (!viewRect || !element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    return (
      rect.left < viewRect.x + viewRect.width &&
      rect.right > viewRect.x &&
      rect.top < viewRect.y + viewRect.height &&
      rect.bottom > viewRect.y
    );
  }

  function evaluate(): void {
    if (intersects()) {
      if (!active) {
        active = true;
        browser.beginOverlay();
      }
    } else if (active) {
      active = false;
      browser.endOverlay();
    }
  }

  /** 双 rAF：等挂载布局与 open 动画首帧稳定后再测（动画结束另有 animationend 重测） */
  function scheduleEvaluate(): void {
    if (frame) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(evaluate);
    });
  }

  function stopTracking(): void {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (element) {
      element.removeEventListener("animationend", scheduleEvaluate);
      element.removeEventListener("transitionend", scheduleEvaluate);
      element = null;
    }
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (active) {
      active = false;
      browser.endOverlay();
    }
  }

  function startTracking(el: HTMLElement): void {
    stopTracking();
    element = el;
    observer = new ResizeObserver(scheduleEvaluate);
    observer.observe(el);
    // open/close 动画多为 transform/opacity（不触发 ResizeObserver），结束后重测
    el.addEventListener("animationend", scheduleEvaluate);
    el.addEventListener("transitionend", scheduleEvaluate);
    scheduleEvaluate();
  }

  watch(
    () => resolveElement(source),
    (el) => {
      if (el) {
        startTracking(el);
      } else {
        stopTracking();
      }
    },
    { immediate: true, flush: "post" },
  );

  // 面板尺寸/位置/可见性变化（viewRect 变化）时重新判定
  watch(
    () => browser.viewRect,
    () => {
      if (element) {
        scheduleEvaluate();
      }
    },
    { flush: "post" },
  );

  // 窗口尺寸变化可能同时移动弹层与面板，兜底重测。
  // 注意：个别测试会 stub 出没有原型方法的 window（见 AppSidebar.active.test），能力缺失时跳过
  const canListenResize = typeof window.addEventListener === "function";
  if (canListenResize) {
    window.addEventListener("resize", scheduleEvaluate);
  }

  onBeforeUnmount(() => {
    if (canListenResize) {
      window.removeEventListener("resize", scheduleEvaluate);
    }
    stopTracking();
  });
}

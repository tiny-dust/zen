import { onBeforeUnmount, onMounted } from "vue";

import { useBrowserStore } from "@/stores/browser";

/**
 * 全局弹层感知：任何 HTML 弹层（弹窗 / 菜单 / 下拉 / 右键 / 悬浮卡 / 选择器）打开期间，
 * 压制内嵌浏览器原生视图（WebContentsView）。
 *
 * 为什么需要全局兜底：WebContentsView 挂在窗口 contentView 上，层级高于渲染层一切 HTML，
 * 单个弹层组件各挂守卫（useOverlayGeometry / useBrowserOverlayGuard）容易漏（自定义弹层、
 * 新加组件、遮罩期间视图仍然可见）。这里按 DOM 物化结果统一判定：只要页面上有处于打开
 * 状态的弹层节点，就把视图藏起来；全部关闭后恢复。
 *
 * 判定不区分几何：弹窗遮罩本就把整屏压暗，此时视图继续显示既压住遮罩也压住弹窗边缘，
 * 一律隐藏最符合预期。计数制与组件级守卫共用（browser.beginOverlay/endOverlay），可叠加。
 */
const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "[data-reka-popper-content-wrapper]",
].join(",");

/**
 * 节点是否为「打开中」的弹层：reka-ui 关闭时置 data-state="closed"（退场动画期间仍在 DOM）
 * 或直接卸载节点，两者都视为关闭；显式 hidden / 已脱离文档的节点同样不算。
 */
function isOpenLayer(element: Element): boolean {
  if (!element.isConnected || element.hasAttribute("hidden")) {
    return false;
  }
  return !element.closest('[data-state="closed"]');
}

/** 页面当前是否存在打开中的弹层（导出供单测直接断言） */
export function hasOpenOverlayLayer(root: ParentNode = document): boolean {
  for (const element of root.querySelectorAll(OVERLAY_SELECTOR)) {
    if (isOpenLayer(element)) {
      return true;
    }
  }
  return false;
}

export function useBrowserOverlayAutoGuard(): void {
  const browser = useBrowserStore();
  let observer: MutationObserver | null = null;
  let frame = 0;
  let active = false;
  let mounted = false;

  function sync(): void {
    const open = hasOpenOverlayLayer();
    if (open === active) {
      return;
    }
    active = open;
    if (open) {
      browser.beginOverlay();
    } else {
      browser.endOverlay();
    }
  }

  /** DOM 变更可能成批到达：合并到下一帧统一判定，避免一次弹窗动画里反复记账 */
  function schedule(): void {
    if (frame) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  }

  onMounted(() => {
    if (typeof MutationObserver !== "function") {
      return;
    }
    mounted = true;
    // attributes 只盯 data-state（弹层开合态）；几何变化由 resize 兜底
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    window.addEventListener("resize", schedule);
    schedule();
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    if (mounted) {
      window.removeEventListener("resize", schedule);
    }
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (active) {
      active = false;
      browser.endOverlay();
    }
  });
}

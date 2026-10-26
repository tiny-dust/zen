import { createPinia, setActivePinia, type Pinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h } from "vue";

import {
  hasOpenOverlayLayer,
  useBrowserOverlayAutoGuard,
} from "@/composables/useBrowserOverlayAutoGuard";
import { useBrowserStore } from "@/stores/browser";

/**
 * 等 MutationObserver 投递 + 守卫的 rAF 合并调度跑完。
 * happy-dom 的观察回调走宏任务队列，单等 rAF 可能早于回调投递。
 */
async function flushFrames(count = 3): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function appendLayer(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const first = host.firstElementChild;
  document.body.appendChild(host);
  return first as HTMLElement;
}

describe("hasOpenOverlayLayer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("无弹层时为 false", () => {
    expect(hasOpenOverlayLayer()).toBe(false);
  });

  it("打开中的 dialog / menu / popper 均算弹层", () => {
    expect(hasOpenOverlayLayer()).toBe(false);
    const dialog = appendLayer('<div role="dialog" data-state="open"></div>');
    expect(hasOpenOverlayLayer()).toBe(true);
    dialog.remove();

    const menu = appendLayer('<div role="menu"></div>');
    expect(hasOpenOverlayLayer()).toBe(true);
    menu.remove();

    appendLayer('<div data-reka-popper-content-wrapper=""><div role="listbox"></div></div>');
    expect(hasOpenOverlayLayer()).toBe(true);
  });

  it("关闭态（data-state=closed）与 hidden 节点不算", () => {
    const closed = appendLayer('<div role="dialog" data-state="closed"></div>');
    expect(hasOpenOverlayLayer()).toBe(false);
    closed.remove();

    appendLayer('<div role="dialog" hidden></div>');
    expect(hasOpenOverlayLayer()).toBe(false);
  });

  it("节点脱离文档后不算", () => {
    const dialog = appendLayer('<div role="dialog"></div>');
    dialog.remove();
    expect(hasOpenOverlayLayer()).toBe(false);
  });
});

describe("useBrowserOverlayAutoGuard", () => {
  let unmount: (() => void) | undefined;
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    document.body.innerHTML = "";
  });

  it("弹层出现 → 压制原生视图；全部关闭 → 恢复", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(
      defineComponent({
        setup() {
          useBrowserOverlayAutoGuard();
          return () => h("div", "app");
        },
      }),
    );
    app.use(pinia);
    app.mount(host);
    unmount = () => app.unmount();

    const browser = useBrowserStore();
    await flushFrames();
    expect(browser.overlayDepth).toBe(0);

    const dialog = appendLayer('<div role="dialog" data-state="open"></div>');
    await flushFrames();
    expect(browser.overlayDepth).toBe(1);

    // 第二个弹层叠加不重复记账（已压制中）
    const menu = appendLayer('<div role="menu"></div>');
    await flushFrames();
    expect(browser.overlayDepth).toBe(1);

    dialog.remove();
    await flushFrames();
    expect(browser.overlayDepth).toBe(1);

    menu.remove();
    await flushFrames();
    expect(browser.overlayDepth).toBe(0);
  });

  it("关闭态切换（data-state=closed 属性变更）触发恢复", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(
      defineComponent({
        setup() {
          useBrowserOverlayAutoGuard();
          return () => h("div", "app");
        },
      }),
    );
    app.use(pinia);
    app.mount(host);
    unmount = () => app.unmount();

    const browser = useBrowserStore();
    const dialog = appendLayer('<div role="dialog" data-state="open"></div>');
    await flushFrames();
    expect(browser.overlayDepth).toBe(1);

    dialog.setAttribute("data-state", "closed");
    await flushFrames();
    expect(browser.overlayDepth).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, ref } from "vue";
import { createPinia, setActivePinia, type Pinia } from "pinia";

import { useOverlayGeometry } from "@/composables/useOverlayGeometry";
import { useBrowserStore } from "@/stores/browser";

import type { BrowserViewBounds } from "@zen/shared";

/** 快照 rect：getBoundingClientRect 打桩返回值 */
function fakeRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** 等双 rAF 测量调度跑完 */
async function flushFrames(count = 3): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

/** 挂载一个带几何守卫的弹层元素（与测试共用同一 pinia）；返回卸载函数与元素 rect 打桩 */
function mountOverlay(pinia: Pinia): { unmount: () => void; stubRect: (rect: DOMRect) => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const el = ref<HTMLElement | null>(null);
  const app = createApp(
    defineComponent({
      setup() {
        useOverlayGeometry(el);
        return () => h("div", { ref: el }, "弹层");
      },
    }),
  );
  app.use(pinia);
  app.mount(host);
  return {
    unmount: () => {
      app.unmount();
      host.remove();
    },
    stubRect: (rect: DOMRect) => {
      if (el.value) {
        el.value.getBoundingClientRect = () => rect;
      }
    },
  };
}

describe("useOverlayGeometry", () => {
  let pinia: Pinia;
  let store: ReturnType<typeof useBrowserStore>;
  let beginOverlay: ReturnType<typeof vi.spyOn>;
  let endOverlay: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    store = useBrowserStore();
    store.showHome = false;
    beginOverlay = vi.spyOn(store, "beginOverlay");
    endOverlay = vi.spyOn(store, "endOverlay");
  });

  afterEach(() => {
    store.viewRect = null;
    store.showHome = true;
    document.body.innerHTML = "";
  });

  it("弹层与 viewRect 相交才 beginOverlay", async () => {
    const overlay = mountOverlay(pinia);
    overlay.stubRect(fakeRect(500, 300, 200, 120));
    store.viewRect = { x: 600, y: 200, width: 400, height: 500 };
    await flushFrames();
    expect(beginOverlay).toHaveBeenCalledTimes(1);
    expect(endOverlay).not.toHaveBeenCalled();

    // 持续相交不重复压制
    store.viewRect = { x: 610, y: 210, width: 390, height: 480 };
    await flushFrames();
    expect(beginOverlay).toHaveBeenCalledTimes(1);
    overlay.unmount();
  });

  it("不相交或 viewRect 为空不压制（不闪烁）", async () => {
    const overlay = mountOverlay(pinia);
    overlay.stubRect(fakeRect(0, 0, 200, 120));
    // viewRect 为空：浏览器面板未展开
    await flushFrames();
    expect(beginOverlay).not.toHaveBeenCalled();

    // 完全错开：弹层在左上，视图在右下
    store.viewRect = { x: 600, y: 400, width: 400, height: 500 };
    await flushFrames();
    expect(beginOverlay).not.toHaveBeenCalled();
    overlay.unmount();
  });

  it("卸载时 endOverlay 恢复原生视图", async () => {
    const overlay = mountOverlay(pinia);
    overlay.stubRect(fakeRect(500, 300, 200, 120));
    store.viewRect = { x: 600, y: 200, width: 400, height: 500 };
    await flushFrames();
    expect(beginOverlay).toHaveBeenCalledTimes(1);

    overlay.unmount();
    expect(endOverlay).toHaveBeenCalledTimes(1);
  });

  it("不相交时卸载不额外恢复", async () => {
    const overlay = mountOverlay(pinia);
    overlay.stubRect(fakeRect(0, 0, 100, 100));
    store.viewRect = { x: 600, y: 400, width: 400, height: 500 };
    await flushFrames();
    overlay.unmount();
    expect(endOverlay).not.toHaveBeenCalled();
  });

  it("viewRect 变化重新判定：相交→消失解除，空→出现压制", async () => {
    const overlay = mountOverlay(pinia);
    overlay.stubRect(fakeRect(500, 300, 200, 120));

    // 相交 → 压制；面板收起（viewRect 变空）→ 解除
    store.viewRect = { x: 600, y: 200, width: 400, height: 500 };
    await flushFrames();
    expect(beginOverlay).toHaveBeenCalledTimes(1);
    store.viewRect = null;
    await flushFrames();
    expect(endOverlay).toHaveBeenCalledTimes(1);

    // 面板重新展开 → 再次压制
    store.viewRect = { x: 600, y: 200, width: 400, height: 500 };
    await flushFrames();
    expect(beginOverlay).toHaveBeenCalledTimes(2);
    overlay.unmount();
    expect(endOverlay).toHaveBeenCalledTimes(2);
  });
});

describe("browser store viewRect 记录", () => {
  let store: ReturnType<typeof useBrowserStore>;
  let setBounds: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useBrowserStore();
    store.showHome = false;
    setBounds = vi.fn();
    (window as { zen?: unknown }).zen = { browser: { setBounds } };
  });

  afterEach(() => {
    delete (window as { zen?: unknown }).zen;
    store.viewRect = null;
    store.showHome = true;
    document.body.innerHTML = "";
  });

  it("syncBounds 有效推送记录 viewRect（CSS px = DIP，无需换算）", async () => {
    await store.syncBounds(fakeRect(800, 48, 400, 600), true);
    expect(store.viewRect).toEqual({ x: 800, y: 48, width: 400, height: 600 } satisfies BrowserViewBounds);
    expect(setBounds).toHaveBeenCalledWith({ x: 800, y: 48, width: 400, height: 600 }, true);
  });

  it("历史页/隐藏/画中画时清空 viewRect", async () => {
    await store.syncBounds(fakeRect(800, 48, 400, 600), true);
    expect(store.viewRect).not.toBeNull();

    store.showHome = true;
    await store.syncBounds(fakeRect(800, 48, 400, 600), true);
    expect(store.viewRect).toBeNull();

    store.showHome = false;
    store.status = { ...store.status, pip: true };
    await store.syncBounds(fakeRect(800, 48, 400, 600), true);
    expect(store.viewRect).toBeNull();
  });

  it("弹层压制（overlayDepth>0）期间保留 viewRect 几何", async () => {
    store.beginOverlay();
    await store.syncBounds(fakeRect(800, 48, 400, 600), true);
    // 视图被隐藏（不推送 bounds），但几何记录保留，供后续弹层判定
    expect(setBounds).toHaveBeenCalledWith(null, false);
    expect(store.viewRect).toEqual({ x: 800, y: 48, width: 400, height: 600 });
    store.endOverlay();
  });
});

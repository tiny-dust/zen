import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, nextTick, ref } from "vue";

import { useBrowserOverlayGuard } from "@/composables/useBrowserOverlayGuard";

const beginOverlay = vi.fn();
const endOverlay = vi.fn();

vi.mock("@/stores/browser", () => ({
  useBrowserStore: () => ({ beginOverlay, endOverlay }),
}));

function mountGuard(open: { value: boolean }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(
    defineComponent({
      setup() {
        useBrowserOverlayGuard(() => open.value);
        return () => null;
      },
    }),
  );
  app.mount(host);
  return () => {
    app.unmount();
    host.remove();
  };
}

beforeEach(() => {
  beginOverlay.mockClear();
  endOverlay.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useBrowserOverlayGuard", () => {
  it("关闭状态挂载不压制，打开才 beginOverlay", async () => {
    const open = ref(false);
    const unmount = mountGuard(open);
    expect(beginOverlay).not.toHaveBeenCalled();

    open.value = true;
    await nextTick();
    expect(beginOverlay).toHaveBeenCalledTimes(1);
    expect(endOverlay).not.toHaveBeenCalled();
    unmount();
  });

  it("持续打开不重复压制，关闭只恢复一次", async () => {
    const open = ref(true);
    const unmount = mountGuard(open);
    // immediate: true 挂载即压制
    expect(beginOverlay).toHaveBeenCalledTimes(1);

    open.value = true;
    await nextTick();
    expect(beginOverlay).toHaveBeenCalledTimes(1);

    open.value = false;
    await nextTick();
    expect(endOverlay).toHaveBeenCalledTimes(1);

    open.value = false;
    await nextTick();
    expect(endOverlay).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("打开状态卸载时恢复原生视图", async () => {
    const open = ref(true);
    const unmount = mountGuard(open);
    expect(beginOverlay).toHaveBeenCalledTimes(1);
    unmount();
    expect(endOverlay).toHaveBeenCalledTimes(1);
  });

  it("关闭状态卸载不额外恢复", () => {
    const open = ref(false);
    const unmount = mountGuard(open);
    unmount();
    expect(endOverlay).not.toHaveBeenCalled();
  });

  it("重新打开走新一轮压制", async () => {
    const open = ref(true);
    const unmount = mountGuard(open);
    open.value = false;
    await nextTick();
    open.value = true;
    await nextTick();
    expect(beginOverlay).toHaveBeenCalledTimes(2);
    expect(endOverlay).toHaveBeenCalledTimes(1);
    unmount();
  });
});

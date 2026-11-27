import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

import { useLazyReveal } from "./useLazyReveal";

/** 手动触发的 IntersectionObserver 替身 */
function mockObserver() {
  const callbacks: Array<(entries: Array<{ isIntersecting: boolean; target: Element }>) => void> = [];
  const observed: Element[] = [];
  const unobserved: Element[] = [];

  class FakeObserver {
    constructor(cb: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void) {
      callbacks.push(cb);
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve(el: Element) {
      unobserved.push(el);
    }
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);

  return {
    observed,
    unobserved,
    fire: (entries: Array<{ isIntersecting: boolean; target: Element }>) => {
      for (const cb of callbacks) cb(entries);
    },
    restore: () => vi.unstubAllGlobals(),
  };
}

describe("useLazyReveal", () => {
  it("进入视口的元素被记为可见，之后不再重复观察", async () => {
    const io = mockObserver();
    let api: ReturnType<typeof useLazyReveal> | null = null;

    const Host = defineComponent({
      setup() {
        api = useLazyReveal();
        const el = ref<HTMLElement | null>(null);
        return () =>
          h("div", { ref: el, onClick: () => api!.observe(el.value, "a") }, [
            api!.revealed.value.has("a") ? "shown" : "hidden",
          ]);
      },
    });

    const wrapper = mount(Host);
    await wrapper.get("div").trigger("click");
    expect(io.observed).toHaveLength(1);

    io.fire([{ isIntersecting: true, target: wrapper.get("div").element }]);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toBe("shown");
    expect(io.unobserved).toHaveLength(1);

    // 已可见的元素再登记不会重复观察
    await wrapper.get("div").trigger("click");
    expect(io.observed).toHaveLength(1);
    wrapper.unmount();
    io.restore();
  });

  it("未相交的元素保持未挂载", async () => {
    const io = mockObserver();
    let api: ReturnType<typeof useLazyReveal> | null = null;

    const Host = defineComponent({
      setup() {
        api = useLazyReveal();
        return () => h("div", { ref: (el) => api!.observe(el as HTMLElement | null, "b") }, "x");
      },
    });

    const wrapper = mount(Host);
    io.fire([{ isIntersecting: false, target: wrapper.get("div").element }]);
    await wrapper.vm.$nextTick();
    expect(api!.revealed.value.has("b")).toBe(false);
    wrapper.unmount();
    io.restore();
  });
});

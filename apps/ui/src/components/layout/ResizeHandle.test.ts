import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ResizeHandle from "./ResizeHandle.vue";

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, ...init });
}

function mountHandle() {
  const wrapper = mount(ResizeHandle, { props: { line: true }, attachTo: document.body });
  return { wrapper, el: wrapper.element as HTMLElement };
}

describe("ResizeHandle", () => {
  it("拖动中按位移上报 drag", () => {
    const { wrapper, el } = mountHandle();
    el.dispatchEvent(pointerEvent("pointerdown", { clientX: 100, clientY: 100, buttons: 1 }));
    el.dispatchEvent(pointerEvent("pointermove", { clientX: 112, clientY: 100, buttons: 1 }));
    el.dispatchEvent(pointerEvent("pointermove", { clientX: 130, clientY: 100, buttons: 1 }));
    expect(wrapper.emitted("drag")).toEqual([[12], [18]]);
  });

  it("松手事件落在手柄之外时也结束拖动（窗口外松开 / 捕获丢失）", () => {
    const { wrapper, el } = mountHandle();
    el.dispatchEvent(pointerEvent("pointerdown", { clientX: 100, clientY: 100, buttons: 1 }));
    el.dispatchEvent(pointerEvent("pointermove", { clientX: 120, clientY: 100, buttons: 1 }));
    window.dispatchEvent(pointerEvent("pointerup", { clientX: 120, clientY: 100, buttons: 0 }));
    el.dispatchEvent(pointerEvent("pointermove", { clientX: 200, clientY: 100, buttons: 0 }));
    expect(wrapper.emitted("drag")).toEqual([[20]]);
  });

  it("pointerup 丢失时，按键已松开的那次移动即结束拖动", () => {
    const { wrapper, el } = mountHandle();
    el.dispatchEvent(pointerEvent("pointerdown", { clientX: 100, clientY: 100, buttons: 1 }));
    el.dispatchEvent(pointerEvent("pointermove", { clientX: 120, clientY: 100, buttons: 1 }));
    el.dispatchEvent(pointerEvent("pointermove", { clientX: 160, clientY: 100, buttons: 0 }));
    el.dispatchEvent(pointerEvent("pointermove", { clientX: 220, clientY: 100, buttons: 0 }));
    expect(wrapper.emitted("drag")).toEqual([[20]]);
  });

  it("指针捕获拿到就抛错时，松手仍能结束拖动", () => {
    const { wrapper, el } = mountHandle();
    el.setPointerCapture = () => {
      throw new Error("NotFoundError");
    };
    el.dispatchEvent(pointerEvent("pointerdown", { clientX: 100, clientY: 100, buttons: 1 }));
    el.dispatchEvent(pointerEvent("pointermove", { clientX: 120, clientY: 100, buttons: 1 }));
    window.dispatchEvent(pointerEvent("pointerup", { clientX: 120, clientY: 100, buttons: 0 }));
    el.dispatchEvent(pointerEvent("pointermove", { clientX: 200, clientY: 100, buttons: 0 }));
    expect(wrapper.emitted("drag")).toEqual([[20]]);
  });

  it("拖动结束后不再拖累高亮状态", async () => {
    const { wrapper, el } = mountHandle();
    el.dispatchEvent(pointerEvent("pointerdown", { clientX: 100, clientY: 100, buttons: 1 }));
    window.dispatchEvent(pointerEvent("pointerup", { clientX: 100, clientY: 100, buttons: 0 }));
    await wrapper.vm.$nextTick();
    expect(el.className).not.toContain("after:bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]!");
  });
});

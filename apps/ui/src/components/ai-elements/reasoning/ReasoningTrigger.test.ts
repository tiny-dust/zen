import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it } from "vitest";

import ReasoningTrigger from "@/components/ai-elements/reasoning/ReasoningTrigger.vue";
import { ReasoningKey } from "@/components/ai-elements/reasoning/context";

import type { VueWrapper } from "@vue/test-utils";

function mountTrigger(ctx: {
  isStreaming?: boolean;
  isOpen?: boolean;
  duration?: number;
} = {}): VueWrapper {
  const provided = {
    isStreaming: ref(ctx.isStreaming ?? false),
    isOpen: ref(ctx.isOpen ?? true),
    setIsOpen: () => undefined,
    duration: ref<number | undefined>(ctx.duration),
  };
  return mount(ReasoningTrigger, {
    global: {
      provide: { [ReasoningKey as symbol]: provided },
      stubs: { CollapsibleTrigger: { template: "<button><slot /></button>" } },
      renderStubDefaultSlot: true,
    },
    attachTo: document.body,
  });
}

describe("ReasoningTrigger", () => {
  it("流式中显示思考中", () => {
    const wrapper = mountTrigger({ isStreaming: true, duration: undefined });
    expect(wrapper.text()).toContain("思考中");
    expect(wrapper.text()).not.toContain("思考完成");
    wrapper.unmount();
  });

  it("无 duration 时显示思考完成", () => {
    const wrapper = mountTrigger({ isStreaming: false, duration: undefined });
    expect(wrapper.text()).toContain("思考完成");
    wrapper.unmount();
  });

  it("有 duration 时显示已思考秒数", () => {
    const wrapper = mountTrigger({ isStreaming: false, duration: 12 });
    expect(wrapper.text()).toContain("已思考 12 秒");
    wrapper.unmount();
  });

  it("展开时 chevron 旋转", () => {
    const open = mountTrigger({ isOpen: true });
    expect(open.find("svg.rotate-180").exists()).toBe(true);
    open.unmount();

    const closed = mountTrigger({ isOpen: false });
    expect(closed.find("svg.rotate-0").exists()).toBe(true);
    closed.unmount();
  });

  it("默认插槽可整体覆盖文案", () => {
    const wrapper = mount(ReasoningTrigger, {
      slots: { default: "自定义触发器" },
      global: {
        provide: {
          [ReasoningKey as symbol]: {
            isStreaming: ref(false),
            isOpen: ref(true),
            setIsOpen: () => undefined,
            duration: ref<number | undefined>(undefined),
          },
        },
        stubs: { CollapsibleTrigger: { template: "<button><slot /></button>" } },
        renderStubDefaultSlot: true,
      },
      attachTo: document.body,
    });
    expect(wrapper.text()).toBe("自定义触发器");
    expect(wrapper.text()).not.toContain("思考完成");
    wrapper.unmount();
  });
});

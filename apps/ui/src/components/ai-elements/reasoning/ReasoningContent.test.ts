import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

// Markdown 渲染器与代码高亮扩展对本组件是纯展示依赖，桩掉以聚焦插槽/内容拼装逻辑
vi.mock("vue-stream-markdown", () => ({
  Markdown: {
    name: "Markdown",
    props: ["content", "enableAnimate", "extensions", "isDark"],
    template: '<div class="md-stub">{{ content }}</div>',
  },
}));
vi.mock("@/components/ai-elements/response/extensions", () => ({
  streamMarkdownExtensions: {},
}));

import ReasoningContent from "@/components/ai-elements/reasoning/ReasoningContent.vue";

function mountContent(props: { content: string }, slots?: Record<string, string>) {
  return mount(ReasoningContent, {
    props,
    slots,
    global: {
      stubs: { CollapsibleContent: { template: "<div><slot /></div>" } },
      renderStubDefaultSlot: true,
    },
    attachTo: document.body,
  });
}

describe("ReasoningContent", () => {
  it("渲染 props.content 文本", () => {
    const wrapper = mountContent({ content: "**思考**结论" });
    expect(wrapper.find(".md-stub").text()).toBe("**思考**结论");
    wrapper.unmount();
  });

  it("默认插槽的文本子节点优先于 content prop", () => {
    const wrapper = mountContent({ content: "props 内容" }, { default: "插槽内容" });
    expect(wrapper.find(".md-stub").text()).toBe("插槽内容");
    wrapper.unmount();
  });

  it("内容为空时渲染空串", () => {
    const wrapper = mountContent({ content: "" });
    expect(wrapper.find(".md-stub").text()).toBe("");
    wrapper.unmount();
  });
});

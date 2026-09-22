import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ContextCompactCard from "@/components/chat/ContextCompactCard.vue";

describe("ContextCompactCard", () => {
  it("默认收起，标题醒目，可展开查看摘要全文", async () => {
    const summary = "【会话摘要 · 上下文已压缩】\n\n目标：\n修统计与压缩卡";
    const wrapper = mount(ContextCompactCard, {
      props: { summary, compactedCount: 8, label: "上下文已压缩 · 已折叠 8 条更早消息" },
    });

    expect(wrapper.text()).toContain("上下文已压缩");
    expect(wrapper.text()).toContain("已折叠 8 条更早消息");
    // 默认收起：摘要全文不可见
    expect(wrapper.text()).not.toContain("修统计与压缩卡");

    await wrapper.get("button").trigger("click");
    expect(wrapper.text()).toContain("修统计与压缩卡");
    expect(wrapper.get("pre").text()).toBe(summary);
  });

  it("无折叠条数时回落标签文案", () => {
    const wrapper = mount(ContextCompactCard, {
      props: { summary: "摘要", label: "更早对话已折叠为摘要" },
    });
    expect(wrapper.text()).toContain("更早对话已折叠为摘要");
  });
});

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatMessagePart } from "@zen/shared";

import TraceWorkbench from "./TraceWorkbench.vue";

/** mock 的 chat store：messages 必须是 ref，storeToRefs 才能取到 */
const state = vi.hoisted(() => ({
  messages: null as unknown as { value: ChatMessage[] },
}));

vi.mock("@/stores/chat", async () => {
  const { ref } = await import("vue");
  state.messages = ref<ChatMessage[]>([]);
  return { useChatStore: () => ({ messages: state.messages }) };
});

function setMessages(messages: ChatMessage[]) {
  state.messages.value = messages;
}

function tool(id: string, toolName: string, args: unknown): ChatMessagePart {
  return { type: "tool", toolCallId: id, toolName, state: "ok", args };
}

function fixture(): ChatMessage[] {
  return [
    { id: "u1", role: "user", content: "帮我看看 a.ts", createdAt: 1_000 },
    {
      id: "a1",
      role: "assistant",
      content: "看完了",
      createdAt: 1_000,
      parts: [
        { type: "reasoning", text: "先读三个文件。", ms: 1_200 },
        tool("c1", "readFile", { path: "src/a.ts" }),
        tool("c2", "readFile", { path: "src/b.ts" }),
        tool("c3", "readFile", { path: "src/c.ts" }),
      ],
      meta: {
        run: {
          startedAt: 1_000,
          endedAt: 20_000,
          status: "idle",
          usage: { inputTokens: 1_200, outputTokens: 200 },
        },
      },
    },
  ];
}

describe("TraceWorkbench", () => {
  it("渲染 KPI、7 个视图与轨迹图（默认智能紧凑把连续工具折成聚簇）", () => {
    setMessages(fixture());
    const wrapper = mount(TraceWorkbench);

    const kpi = wrapper.get(".kpi-strip").text();
    expect(kpi).toContain("会话轨迹");
    expect(kpi).toContain("轮次");
    expect(kpi).toContain("工具调用");
    expect(kpi).toContain("Token");

    const tabs = wrapper.findAll('[role="tab"]').map((tab) => tab.text());
    expect(tabs).toEqual([
      "轨迹图",
      "时间线",
      "思考脉络",
      "模型分析",
      "网关请求",
      "子进程收发",
      "原始事件",
    ]);

    // user + thinking + reply 三张卡，3 个 readFile 折成 1 张聚簇卡
    expect(wrapper.findAll(".node-card")).toHaveLength(3);
    expect(wrapper.findAll(".cluster-card")).toHaveLength(1);
    // 默认展示右侧检查器
    expect(wrapper.find(".inspector").exists()).toBe(true);
    wrapper.unmount();
  });

  it("无数据的三类视图给出空态文案，原始事件给出 JSON", async () => {
    setMessages(fixture());
    const wrapper = mount(TraceWorkbench);

    const triggers = wrapper.findAll('[role="tab"]');
    // reka-ui 的 TabsTrigger 在 mousedown 时激活
    const byLabel = async (label: string) => {
      const tab = triggers.find((item) => item.text() === label)!;
      await tab.trigger("mousedown");
      await tab.trigger("click");
    };

    await byLabel("网关请求");
    expect(wrapper.get(".empty-view").text()).toContain("这一轮没有经过网关的模型请求");

    await byLabel("子进程收发");
    expect(wrapper.get(".empty-view").text()).toContain("这一范围没有子进程收发记录");

    await byLabel("模型分析");
    expect(wrapper.get(".empty-view").text()).toContain("没有模型指纹数据");

    await byLabel("原始事件");
    expect(wrapper.get(".raw-pane").text()).toContain("readFile");
    wrapper.unmount();
  });

  it("搜索输入防抖 150ms 后才过滤，清空立刻生效", async () => {
    setMessages(fixture());
    const wrapper = mount(TraceWorkbench);
    vi.useFakeTimers();
    try {
      const search = wrapper.get(".search-box input");
      await search.setValue("src/b.ts");
      // 防抖窗口内仍用上一轮（空查询 = 全部 6 个节点）的结果，不会每个键都全量重算
      expect(wrapper.get(".match-count").text()).toContain("匹配 1/6");

      vi.advanceTimersByTime(160);
      await wrapper.vm.$nextTick();
      expect(wrapper.get(".match-count").text()).toContain("匹配 1/1");

      await search.setValue("");
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".match-count").exists()).toBe(false);
    } finally {
      vi.useRealTimers();
      wrapper.unmount();
    }
  });

  it("搜索切到时间线后仍按词过滤，过滤 chip 只在有数据时出现", async () => {
    setMessages(fixture());
    const wrapper = mount(TraceWorkbench);

    const search = wrapper.get(".search-box input");
    await search.setValue("src/b.ts");
    // 输入防抖 150ms 后才真正过滤
    await new Promise((resolve) => setTimeout(resolve, 220));
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".match-count").text()).toContain("匹配 1/1");

    // 没有失败 / 慢步骤数据
    const chips = wrapper.findAll(".filter-chip").map((chip) => chip.text());
    expect(chips.some((text) => text.includes("仅看失败"))).toBe(false);
    expect(chips.some((text) => text.includes("慢步骤"))).toBe(false);
    wrapper.unmount();
  });
});

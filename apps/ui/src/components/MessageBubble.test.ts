import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import MessageBubble from "@/components/MessageBubble.vue";

import type { ChatMessage } from "@zen/shared";

vi.mock("@/stores/chat", () => ({
  useChatStore: () => ({
    runSummary: null,
    runStartedAt: null,
    statusText: "",
    input: "",
  }),
}));

vi.mock("@/stores/right-panel", () => ({
  useRightPanelStore: () => ({
    revealFile: vi.fn(),
  }),
}));

function mountMessage(message: ChatMessage, streaming = false) {
  return mount(MessageBubble, {
    props: { message, streaming },
    global: {
      stubs: {
        Reasoning: true,
        ReasoningTrigger: true,
        ReasoningContent: true,
        Response: true,
        Loader: true,
        Attachments: true,
        Attachment: true,
        AttachmentPreview: true,
        AttachmentInfo: true,
      },
    },
  });
}

describe("MessageBubble 终态与工具语义", () => {
  it("assistant 取消终态显示文字状态", () => {
    const wrapper = mountMessage({
      id: "a1",
      role: "assistant",
      content: "",
      createdAt: 1,
      meta: { run: { reason: "cancelled" } },
    });
    expect(wrapper.text()).toContain("已取消");
  });

  it("assistant 运行失败展示原因", () => {
    const wrapper = mountMessage({
      id: "a2",
      role: "assistant",
      content: "partial",
      createdAt: 1,
      meta: { run: { reason: "error", error: "上游超时" } },
    });
    expect(wrapper.text()).toContain("运行失败");
    expect(wrapper.text()).toContain("上游超时");
  });

  it("达到步骤上限可被看到", () => {
    const wrapper = mountMessage({
      id: "a3",
      role: "assistant",
      content: "",
      createdAt: 1,
      meta: { run: { reason: "max_steps", step: 30 } },
    });
    expect(wrapper.text()).toContain("已达到步骤上限");
  });

  it("system 默认中性，danger 才告警", () => {
    const neutral = mountMessage({
      id: "s1",
      role: "system",
      content: "上下文已压缩",
      createdAt: 1,
    });
    expect(neutral.text()).toContain("上下文已压缩");
    expect(neutral.find('[role="alert"]').exists()).toBe(false);

    const danger = mountMessage({
      id: "s2",
      role: "system",
      content: "供应商密钥无效",
      createdAt: 1,
      meta: { severity: "danger" },
    });
    expect(danger.find('[role="alert"]').exists()).toBe(true);
  });

  it("工具 part 展示动作/状态词与 denied 终态", () => {
    const wrapper = mountMessage({
      id: "a4",
      role: "assistant",
      content: "",
      createdAt: 1,
      parts: [
        {
          type: "tool",
          toolCallId: "t1",
          toolName: "writeFile",
          state: "denied",
          args: { path: "src/a.ts", content: "x" },
          error: "用户拒绝了这次工具调用",
          summary: "已拒绝执行",
        },
        {
          type: "tool",
          toolCallId: "t2",
          toolName: "runTerminal",
          state: "cancelled",
          args: { command: "pnpm test" },
          error: "运行已取消，工具未完成",
        },
      ],
    });
    expect(wrapper.text()).toContain("写入文件");
    expect(wrapper.text()).toContain("已拒绝");
    expect(wrapper.text()).toContain("执行终端");
    expect(wrapper.text()).toContain("已取消");
  });

  it("正常 stop 显示弱化的已完成，不显示失败文案", () => {
    const wrapper = mountMessage({
      id: "a5",
      role: "assistant",
      content: "ok",
      createdAt: 1,
      meta: { run: { reason: "stop", step: 2, usage: { inputTokens: 1, outputTokens: 2 } } },
    });
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).toContain("共 2 步");
    expect(wrapper.text()).toContain("输入 1 / 输出 2");
    expect(wrapper.text()).not.toContain("运行失败");
    expect(wrapper.text()).not.toContain("已取消");
    expect(wrapper.text()).not.toContain("已达到步骤上限");
  });
});

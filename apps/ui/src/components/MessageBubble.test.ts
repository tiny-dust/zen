import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import MessageBubble from "@/components/MessageBubble.vue";

import type { ChatMessage } from "@zen/shared";

vi.mock("@/stores/chat", () => ({
  useChatStore: () => ({
    runSummary: null,
    runStartedAt: null,
    statusText: "",
    input: "",
    elementMarks: [] as unknown[],
  }),
}));

const revealFile = vi.hoisted(() => vi.fn());

vi.mock("@/stores/right-panel", () => ({
  useRightPanelStore: () => ({
    revealFile,
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

  it("user 消息以 tag 展示页面元素，正文隐藏 $el token", () => {
    const wrapper = mountMessage({
      id: "u1",
      role: "user",
      content: "请点 $el:登录 提交",
      createdAt: 1,
      meta: {
        elementMarks: [
          {
            id: "be_1",
            label: "登录",
            token: "$el:登录",
            ref: {
              selector: "#login",
              selectorCandidates: ["#login"],
              tag: "button",
              id: "login",
              className: "btn",
              text: "登录",
              name: "",
              type: "submit",
              placeholder: "",
              ariaLabel: "登录按钮",
              role: "button",
              href: "",
              rect: { x: 0, y: 0, width: 80, height: 32 },
              pageUrl: "https://example.com/",
              pageTitle: "Example",
            },
          },
        ],
      },
    });
    expect(wrapper.text()).toContain("登录");
    expect(wrapper.text()).toContain("请点");
    expect(wrapper.text()).not.toContain("$el:");
    expect(wrapper.find(".lucide").exists()).toBe(true);
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

  it("contextCompact 走专用压缩卡，不走普通工具行", async () => {
    const wrapper = mountMessage({
      id: "c1",
      role: "tool",
      content: "",
      createdAt: 1,
      toolCallId: "tc1",
      meta: {
        toolName: "contextCompact",
        ok: true,
        state: "ok",
        summary: "上下文已压缩 · 已折叠 6 条更早消息",
        args: { compactedTurns: 6 },
        output: "【会话摘要 · 上下文已压缩】\n目标：\n修统计",
      },
    });
    expect(wrapper.text()).toContain("上下文已压缩");
    expect(wrapper.text()).toContain("已折叠 6 条更早消息");
    // 默认收起摘要全文
    expect(wrapper.text()).not.toContain("修统计");
    await wrapper.get("button").trigger("click");
    expect(wrapper.text()).toContain("修统计");
  });
});

describe("MessageBubble 文件引用", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as { zen?: unknown }).zen;
    revealFile.mockClear();
  });

  function mountUserWithAttachment() {
    return mountMessage({
      id: "u-att",
      role: "user",
      content: "看下这个文件",
      createdAt: 1,
      meta: { attachments: [{ name: "a.ts", path: "/tmp/upload/a.ts" }] },
    });
  }

  it("附件 chip 点击后在右侧面板打开", async () => {
    const wrapper = mountUserWithAttachment();
    await wrapper.get("button").trigger("click");
    expect(revealFile).toHaveBeenCalledWith("/tmp/upload/a.ts");
    wrapper.unmount();
  });

  it("附件 chip 右键弹出文件菜单", async () => {
    (window as { zen?: unknown }).zen = {
      shell: {
        openPath: vi.fn(),
        showInFolder: vi.fn(),
        platformInfo: vi.fn().mockResolvedValue({
          platform: "darwin",
          showInFolderLabel: "在 Finder 中显示",
          openFolderLabel: "打开文件夹",
        }),
      },
    };
    const wrapper = mountUserWithAttachment();
    await wrapper.get(".file-label").trigger("contextmenu");
    await flushPromises();
    const items = [...document.body.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim());
    expect(items).toEqual(["打开文件", "在 Finder 中显示"]);
    wrapper.unmount();
  });
});

// 回归：发送后（首个流事件前）消息区必须立刻有「思考中」反馈。
// 此前思考 loader 只存在于助手气泡内，而助手气泡要等首个流事件才由
// ensureAssistantMessage 创建——长历史会话首个 token 前整段时间线毫无反馈，
// 体感像「发送后在等某些事情处理完」。思考占位按当前会话的运行态派生，
// 切会话即消失，各会话反馈互不影响。
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@zen/shared";

// 真实 pinia store 的 computed/ref 经 store proxy 自动解包：组件直接读
// chatStore.isRunning（布尔），而 messages/lastError 走 storeToRefs 必须是 ref。
// 每个用例重新 mount 且测试前写好状态，故非 ref 属性无需响应式。
const sessionId = ref("s-1");
const chatState = {
  messages: ref<ChatMessage[]>([]),
  lastError: ref(""),
  isRunning: false,
  isPreparing: false,
  pendingApproval: null as unknown,
  get sessionId() { return sessionId.value; },
  set sessionId(value: string) { sessionId.value = value; },
};

vi.mock("@/stores/chat", () => ({
  useChatStore: () => chatState,
}));

vi.mock("@/components/MessageBubble.vue", () => ({
  default: {
    name: "MessageBubble",
    props: ["message", "streaming", "exportable"],
    emits: ["exportTurn"],
    template: "<div class='stub-bubble' @click=\"$emit('exportTurn')\" />",
  },
}));
vi.mock("@/components/chat/ToolCallGroup.vue", () => ({
  default: { name: "ToolCallGroup", template: "<div class='stub-tools' />" },
}));
vi.mock("@/components/chat/ApprovalCard.vue", () => ({
  default: { name: "ApprovalCard", template: "<div class='stub-approval' />" },
}));

import ChatTimeline from "@/components/chat/ChatTimeline.vue";
import ExportSessionDialog from "@/components/session/ExportSessionDialog.vue";

function userMsg(id: string): ChatMessage {
  return { id, role: "user", content: "在吗", createdAt: 1 };
}

function assistantMsg(id: string): ChatMessage {
  return { id, role: "assistant", content: "在", createdAt: 2 };
}

function mountTimeline() {
  return mount(ChatTimeline, {
    global: {
      stubs: { Loader: true },
    },
  });
}

describe("ChatTimeline 思考占位", () => {
  it("运行中且助手尚未开口：立刻显示思考占位", () => {
    chatState.messages.value = [userMsg("u1")];
    chatState.isRunning = true;
    chatState.isPreparing = false;
    chatState.lastError.value = "";

    const wrapper = mountTimeline();

    expect(wrapper.text()).toContain("正在思考");
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it("助手气泡已开口：占位让位给气泡内 loader（不重复显示）", () => {
    chatState.messages.value = [userMsg("u1"), assistantMsg("a1")];
    chatState.isRunning = true;
    chatState.isPreparing = false;

    const wrapper = mountTimeline();

    expect(wrapper.text()).not.toContain("正在思考");
  });

  it("运行结束：占位消失", () => {
    chatState.messages.value = [userMsg("u1")];
    chatState.isRunning = false;
    chatState.isPreparing = false;

    const wrapper = mountTimeline();

    expect(wrapper.text()).not.toContain("正在思考");
  });

  it("会话反馈互不影响：A 会话运行中，B 会话（空闲）不显示占位", () => {
    // A 会话：运行中 + 未开口
    chatState.messages.value = [userMsg("u1")];
    chatState.isRunning = true;
    chatState.isPreparing = false;
    expect(mountTimeline().text()).toContain("正在思考");

    // 切到 B 会话：store 复位为 idle + 自己的消息
    chatState.sessionId = "s-2";
    chatState.messages.value = [userMsg("b1"), assistantMsg("b1-a")];
    chatState.isRunning = false;
    chatState.isPreparing = false;

    const b = mountTimeline();
    expect(b.text()).not.toContain("正在思考");
  });

  it("历史会话发送准备中：旧助手仍在消息尾时也立即显示占位", () => {
    chatState.messages.value = [userMsg("u1"), assistantMsg("a1")];
    chatState.isRunning = false;
    chatState.isPreparing = true;

    expect(mountTimeline().find('[role="status"]').exists()).toBe(true);
  });

  it("新会话发送准备中：没有消息时显示占位", () => {
    chatState.messages.value = [];
    chatState.isRunning = false;
    chatState.isPreparing = true;

    expect(mountTimeline().find('[role="status"]').exists()).toBe(true);
  });
});

describe("ChatTimeline 长会话切换", () => {
  it("切入长历史时首轮渲染受控，且仍能读取更早的记录", async () => {
    const count = 1600;
    chatState.messages.value = [userMsg("old")];
    chatState.isRunning = false;
    chatState.isPreparing = false;
    const wrapper = mountTimeline();
    const history = Array.from({ length: count }, (_, index) =>
      index % 2 ? assistantMsg(`a-${index}`) : userMsg(`u-${index}`),
    );
    const started = performance.now();
    chatState.sessionId = "long-session";
    chatState.messages.value = history;
    await wrapper.vm.$nextTick();
    const duration = performance.now() - started;
    const rendered = wrapper.findAll(".chat-item").length;
    console.info(`[switch-benchmark] history=${count} firstPaint=${duration.toFixed(1)}ms rows=${rendered}`);
    expect(rendered).toBeLessThanOrEqual(80);
    expect(wrapper.find('.chat-item[data-mid="a-1599"]').exists()).toBe(true);
    expect(wrapper.find('.chat-item[data-mid="u-0"]').exists()).toBe(false);
    await wrapper.find('[data-testid="load-earlier-messages"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".chat-item").length).toBeGreaterThan(rendered);
    chatState.sessionId = "another-session";
    chatState.messages.value = history.map((message) => ({ ...message, id: `next-${message.id}` }));
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".chat-item").length).toBe(80);
    expect(wrapper.find('.chat-item[data-mid="next-a-1599"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("ChatTimeline 长会话流式刻度", () => {
  it("末尾消息增长时只测末行位置，不每次重测整段历史", async () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    let notifyResize: ResizeObserverCallback = () => undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { notifyResize = callback; }
      observe() { /* test observer */ }
      disconnect() { /* test observer */ }
    });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ top: 0, right: 0, height: 0 } as DOMRect),
    );
    chatState.messages.value = Array.from({ length: 80 }, (_, index) =>
      index % 2 ? assistantMsg(`a-${index}`) : userMsg(`u-${index}`),
    );
    chatState.isRunning = true;
    chatState.isPreparing = false;
    const wrapper = mountTimeline();
    try {
      await wrapper.vm.$nextTick();
      frames.splice(0).forEach((frame) => frame(0));
      expect(rect.mock.calls.length).toBeGreaterThan(80);
      rect.mockClear();
      chatState.messages.value.at(-1)!.content += "流式增量";
      await wrapper.vm.$nextTick();
      notifyResize([], {} as ResizeObserver);
      frames.splice(0).forEach((frame) => frame(0));
      expect(rect.mock.calls.length).toBeLessThan(10);
    } finally {
      wrapper.unmount();
      raf.mockRestore();
      rect.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe("ChatTimeline 本轮导出入口", () => {
  it("仅用户轮次后的已完成助手消息可导出，事件保留弹窗目标 ID", async () => {
    chatState.messages.value = [
      { ...assistantMsg("orphan"), meta: { run: { reason: "stop" } } },
      userMsg("u1"),
      { ...assistantMsg("done"), meta: { run: { reason: "stop" } } },
      userMsg("u2"),
      { ...assistantMsg("failed"), meta: { run: { reason: "error" } } },
    ];
    chatState.isRunning = false;
    chatState.isPreparing = false;
    const wrapper = mountTimeline();
    const bubbles = wrapper.findAllComponents({ name: "MessageBubble" });
    expect(bubbles.map((bubble) => bubble.props("exportable"))).toEqual([false, false, true, false, false]);
    expect(wrapper.find('[aria-label="导出本轮"]').exists()).toBe(false);

    await bubbles[2]!.trigger("click");
    const dialog = wrapper.findComponent(ExportSessionDialog);
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("assistantMessageId")).toBe("done");
  });
});

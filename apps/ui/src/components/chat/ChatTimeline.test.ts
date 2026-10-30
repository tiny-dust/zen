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
const chatState = {
  messages: ref<ChatMessage[]>([]),
  lastError: ref(""),
  isRunning: false,
  isPreparing: false,
  pendingApproval: null as unknown,
  sessionId: "s-1",
};

vi.mock("@/stores/chat", () => ({
  useChatStore: () => chatState,
}));

vi.mock("@/components/MessageBubble.vue", () => ({
  default: { name: "MessageBubble", template: "<div class='stub-bubble' />" },
}));
vi.mock("@/components/chat/ToolCallGroup.vue", () => ({
  default: { name: "ToolCallGroup", template: "<div class='stub-tools' />" },
}));
vi.mock("@/components/chat/ApprovalCard.vue", () => ({
  default: { name: "ApprovalCard", template: "<div class='stub-approval' />" },
}));

import ChatTimeline from "@/components/chat/ChatTimeline.vue";

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

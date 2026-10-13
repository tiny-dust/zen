import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import McpAppFrame from "./McpAppFrame.vue";

// chat store 只做被调用方断言，不引入真实 store（发送/插入均为 mock）
const chatMocks = vi.hoisted(() => ({
  send: vi.fn(),
  insertAtComposerCaret: vi.fn(),
}));

vi.mock("@/stores/chat", () => ({
  useChatStore: () => chatMocks,
}));

/**
 * 以指定 source 在 window 上派发 message 事件：
 * source 用 defineProperty 注入，避免依赖测试环境对 MessageEvent init.source 的支持。
 */
function dispatchMessage(data: unknown, source: unknown) {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

/**
 * happy-dom 的 iframe.contentWindow 恒为 null（组件按 event.source === contentWindow 校验），
 * 用实例自有属性覆盖原型 getter，注入一个稳定可判等的假窗口作为合法来源。
 */
function stubFrameSource(wrapper: ReturnType<typeof mount>): object {
  const source = {};
  const frame = wrapper.get("iframe").element as HTMLIFrameElement;
  Object.defineProperty(frame, "contentWindow", { value: source, configurable: true });
  return source;
}

function mountFrame() {
  return mount(McpAppFrame, { props: { html: "<p>app</p>" } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("McpAppFrame 工具结果回传", () => {
  it("auto 消息：自动调用 send 发给 Agent，并展示「已回传」", async () => {
    const wrapper = mountFrame();
    dispatchMessage({ type: "zen:mcp", payload: { action: "confirm" }, auto: true }, stubFrameSource(wrapper));

    await flushPromises();
    expect(chatMocks.send).toHaveBeenCalledTimes(1);
    expect(chatMocks.send).toHaveBeenCalledWith('[MCP App 交互事件] {\n  "action": "confirm"\n}');
    expect(wrapper.text()).toContain("已回传");
    wrapper.unmount();
  });

  it("非 auto 消息：只记录事件，不触发 send，也无「已回传」标记", async () => {
    const wrapper = mountFrame();
    dispatchMessage({ type: "zen:mcp", payload: { action: "pick" } }, stubFrameSource(wrapper));

    await flushPromises();
    expect(chatMocks.send).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("收到交互事件");
    expect(wrapper.text()).not.toContain("已回传");
    wrapper.unmount();
  });

  it("手动「发送给 Agent」按钮：立即以用户消息发送最近一次交互事件", async () => {
    const wrapper = mountFrame();
    dispatchMessage({ type: "zen:mcp", payload: { action: "pick" } }, stubFrameSource(wrapper));
    await flushPromises();
    expect(chatMocks.send).not.toHaveBeenCalled();

    await wrapper.get('[aria-label="发送给 Agent"]').trigger("click");
    await flushPromises();
    expect(chatMocks.send).toHaveBeenCalledTimes(1);
    expect(chatMocks.send).toHaveBeenCalledWith('[MCP App 交互事件] {\n  "action": "pick"\n}');
    expect(wrapper.text()).toContain("已回传");
    wrapper.unmount();
  });

  it("source 不匹配的消息被忽略：不记录事件、不触发 send", async () => {
    const wrapper = mountFrame();
    dispatchMessage({ type: "zen:mcp", payload: { action: "spoof" }, auto: true }, {});

    await flushPromises();
    expect(chatMocks.send).not.toHaveBeenCalled();
    // 没有任何事件时 footer 仍是沙箱提示，而非事件列表
    expect(wrapper.text()).toContain("沙箱模式：不加载外部资源");
    expect(wrapper.text()).not.toContain("收到交互事件");
    wrapper.unmount();
  });
});

import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/locales";
import { useSideChatStore } from "@/stores/side-chat";

import SideChatPanel from "./SideChatPanel.vue";

import type { SideChatRecord, SideChatStreamEvent } from "@zen/shared";

function makeRecord(extra: Partial<SideChatRecord> = {}): SideChatRecord {
  return {
    id: "c1",
    sessionId: "s1",
    workspaceId: "common",
    title: "侧边对话 1",
    seq: 1,
    messages: [],
    draft: "",
    model: null,
    effort: null,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function stubZen(record: SideChatRecord) {
  const handlers: Array<(event: SideChatStreamEvent) => void> = [];
  const save = vi.fn(async () => ({ ok: true }));
  const send = vi.fn(async () => ({ ok: true }));
  const stop = vi.fn(async () => ({ ok: true }));
  (window as unknown as { zen: unknown }).zen = {
    sideChat: {
      list: async () => ({ chats: [record] }),
      create: async () => record,
      save,
      remove: vi.fn(async () => ({ ok: true })),
      setModel: vi.fn(async () => ({ ok: true })),
      send,
      stop,
      onStream: (handler: (event: SideChatStreamEvent) => void) => {
        handlers.push(handler);
        return () => {
          const index = handlers.indexOf(handler);
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        };
      },
    },
  };
  function emit(event: SideChatStreamEvent) {
    for (const handler of [...handlers]) {
      handler(event);
    }
  }
  return { save, send, stop, emit };
}

async function mountPanel() {
  const pinia = createPinia();
  setActivePinia(pinia);
  await useSideChatStore().load("s1");
  return mount(SideChatPanel, {
    props: { chatId: "c1" },
    global: { plugins: [pinia, i18n] },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("SideChatPanel", () => {
  it("空态 → 发送后画本地气泡，done 后换成落库消息", async () => {
    const bridge = stubZen(makeRecord());
    const wrapper = await mountPanel();
    await flushPromises();

    expect(wrapper.get('[data-testid="side-chat-empty"]').text()).toContain("只属于当前会话");

    const composer = wrapper.get('[data-testid="side-chat-composer"]');
    await composer.setValue("你好");
    await wrapper.get('[data-testid="side-chat-send"]').trigger("click");
    await flushPromises();

    expect(bridge.send).toHaveBeenCalledWith("c1", "你好");
    expect(wrapper.text()).toContain("你好");

    bridge.emit({ id: "c1", type: "delta", text: " parcial" });
    bridge.emit({ id: "c1", type: "delta", text: "回复" });
    await flushPromises();
    expect(wrapper.text()).toContain(" parcial回复");

    bridge.emit({
      id: "c1",
      type: "done",
      message: { id: "a1", role: "assistant", text: "最终回复", at: 10 },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("最终回复");
    expect(wrapper.text()).not.toContain(" parcial回复");
    expect(wrapper.find('[data-testid="side-chat-empty"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("草稿按侧聊恢复，失焦时落库", async () => {
    const bridge = stubZen(makeRecord({ draft: "上次没发完的草稿" }));
    const wrapper = await mountPanel();
    await flushPromises();

    const composer = wrapper.get('[data-testid="side-chat-composer"]');
    expect((composer.element as HTMLTextAreaElement).value).toBe("上次没发完的草稿");

    await composer.setValue("改了一半");
    await composer.trigger("blur");
    await flushPromises();

    expect(bridge.save).toHaveBeenCalled();
    expect(useSideChatStore().draftOf("c1")).toBe("改了一半");

    wrapper.unmount();
  });

  it("错误气泡显示真实原因，不吞掉", async () => {
    const bridge = stubZen(makeRecord());
    const wrapper = await mountPanel();
    await flushPromises();

    await wrapper.get('[data-testid="side-chat-composer"]').setValue("会失败");
    await wrapper.get('[data-testid="side-chat-send"]').trigger("click");
    await flushPromises();

    bridge.emit({ id: "c1", type: "error", error: "模型超时" });
    await flushPromises();

    const error = wrapper.get('[data-testid="side-chat-error"]');
    expect(error.text()).toContain("模型超时");

    wrapper.unmount();
  });
});

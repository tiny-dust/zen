import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRightPanelStore } from "@/stores/right-panel";
import { useSideChatStore } from "@/stores/side-chat";

import type {
  SideChatListResult,
  SideChatMessage,
  SideChatRecord,
  SideChatStreamEvent,
} from "@zen/shared";

function makeRecord(id: string, sessionId = "s1", extra: Partial<SideChatRecord> = {}): SideChatRecord {
  return {
    id,
    sessionId,
    workspaceId: "common",
    title: `侧边对话 ${id}`,
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

function stubZen(chats: SideChatRecord[] = []) {
  const handlers: Array<(event: SideChatStreamEvent) => void> = [];
  const list = vi.fn(async (sessionId: string): Promise<SideChatListResult> => ({
    chats: chats.filter((chat) => chat.sessionId === sessionId),
  }));
  const create = vi.fn(async (sessionId: string) => makeRecord(`c${chats.length + 1}`, sessionId));
  const save = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }));
  const remove = vi.fn(async (): Promise<{ ok: boolean }> => ({ ok: true }));
  const setModel = vi.fn(async (): Promise<{ ok: boolean }> => ({ ok: true }));
  const send = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }));
  const stop = vi.fn(async (): Promise<{ ok: boolean }> => ({ ok: true }));
  const onStream = vi.fn((handler: (event: SideChatStreamEvent) => void) => {
    handlers.push(handler);
    return () => {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    };
  });

  (window as unknown as { zen: unknown }).zen = {
    sideChat: { list, create, save, remove, setModel, send, stop, onStream },
  };

  function emit(event: SideChatStreamEvent) {
    for (const handler of [...handlers]) {
      handler(event);
    }
  }

  return { list, create, save, remove, setModel, send, stop, onStream, emit, handlers };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSideChatStore", () => {
  it("create 后打开标签：同一条记录只有一标签，且记录留在 store", async () => {
    const bridge = stubZen();
    const store = useSideChatStore();
    const panel = useRightPanelStore();

    const record = await store.create("s1");
    expect(record).not.toBeNull();
    expect(bridge.create).toHaveBeenCalledWith("s1");

    panel.ensureSideChat(record!);
    panel.ensureSideChat(record!);

    const sideTabs = panel.tabs.filter((tab) => tab.kind === "side-chat");
    expect(sideTabs).toHaveLength(1);
    expect(sideTabs[0].id).toBe(`side-chat:${record!.id}`);
    expect(panel.activeId).toBe(`side-chat:${record!.id}`);
    expect(store.recordOf(record!.id)).not.toBeNull();
  });

  it("关闭标签只关视图：不调用 remove，记录仍可从历史重开", async () => {
    const bridge = stubZen();
    const store = useSideChatStore();
    const panel = useRightPanelStore();

    const record = (await store.create("s1"))!;
    panel.ensureSideChat(record);
    panel.closeTab(`side-chat:${record.id}`);

    expect(bridge.remove).not.toHaveBeenCalled();
    expect(panel.tabs.some((tab) => tab.kind === "side-chat")).toBe(false);
    expect(store.recordOf(record.id)).not.toBeNull();
    expect(store.list.map((item) => item.id)).toContain(record.id);

    // 历史里点同一条记录：标签恢复，仍是一个
    panel.ensureSideChat(record);
    expect(panel.tabs.filter((tab) => tab.kind === "side-chat")).toHaveLength(1);
    expect(panel.activeTab?.id).toBe(`side-chat:${record.id}`);
  });

  it("delta 累加、done 用返回的 message 覆盖并清 live", async () => {
    const record = makeRecord("c1");
    const bridge = stubZen([record]);
    const store = useSideChatStore();
    const unbind = store.bindStream();

    await store.load("s1");
    expect(bridge.list).toHaveBeenCalledWith("s1");

    const result = await store.send("c1", "你好");
    expect(result.ok).toBe(true);
    expect(store.draftOf("c1")).toBe("");

    bridge.emit({ id: "c1", type: "delta", text: "你" });
    bridge.emit({ id: "c1", type: "delta", text: "好呀" });
    expect(store.liveOf("c1")?.text).toBe("你好呀");
    expect(store.liveOf("c1")?.running).toBe(true);

    const answer: SideChatMessage = { id: "a1", role: "assistant", text: "你好呀", at: 10 };
    bridge.emit({ id: "c1", type: "done", message: answer });

    expect(store.liveOf("c1")).toBeNull();
    const messages = store.recordOf("c1")!.messages;
    expect(messages.map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(messages[0].text).toBe("你好");
    expect(messages[1]).toEqual(answer);

    unbind();
  });

  it("error 保留草稿，并在消息里留下失败原因", async () => {
    const record = makeRecord("c1");
    const bridge = stubZen([record]);
    const store = useSideChatStore();
    const unbind = store.bindStream();

    await store.load("s1");

    await store.send("c1", "会失败的一轮");
    // 回答进行中用户已经在给下一条写草稿
    store.saveDraft("c1", "还没发出去的草稿");
    bridge.emit({ id: "c1", type: "delta", text: "半截" });
    bridge.emit({ id: "c1", type: "error", error: "模型超时" });

    // 草稿是对下一条消息的输入，错误不能把它清掉；运行中挂起的落库在收尾时补写
    expect(store.draftOf("c1")).toBe("还没发出去的草稿");
    expect(bridge.save).toHaveBeenCalled();
    const messages = store.recordOf("c1")!.messages;
    const failed = messages[messages.length - 1];
    expect(failed.role).toBe("assistant");
    expect(failed.error).toBe("模型超时");
    expect(store.liveOf("c1")).toBeNull();

    unbind();
  });

  it("send 失败时把原文回填草稿，输入不丢", async () => {
    const bridge = stubZen([makeRecord("c1")]);
    bridge.send.mockResolvedValueOnce({ ok: false, error: "正在回答中" });
    const store = useSideChatStore();
    await store.load("s1");

    const result = await store.send("c1", "失败的原文");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("正在回答中");
    expect(store.draftOf("c1")).toBe("失败的原文");
    expect(store.liveOf("c1")).toBeNull();
    expect(store.recordOf("c1")!.messages).toHaveLength(0);
  });

  it("切换会话后按新 session 加载，列表只属于当前会话", async () => {
    const bridge = stubZen([makeRecord("a", "s1"), makeRecord("b", "s2")]);
    const store = useSideChatStore();

    await store.load("s1");
    expect(store.list.map((item) => item.id)).toEqual(["a"]);

    await store.load("s2");
    expect(bridge.list).toHaveBeenLastCalledWith("s2");
    expect(store.list.map((item) => item.id)).toEqual(["b"]);
    // 之前会话的记录快照还在，标签切回来不会空白
    expect(store.recordOf("a")).not.toBeNull();
  });

  it("面板全关期间结束的一轮：重新挂载时按落库消息对齐，不卡在运行中", async () => {
    const chats = [makeRecord("c1")];
    stubZen(chats);
    const store = useSideChatStore();
    const unbind = store.bindStream();
    await store.load("s1");
    await store.send("c1", "跑一轮");
    expect(store.liveOf("c1")?.running).toBe(true);

    // 关掉所有面板：退订，期间主进程写完这一轮（事件没人收）
    unbind();
    chats.splice(
      0,
      1,
      makeRecord("c1", "s1", {
        messages: [
          { id: "u1", role: "user", text: "跑一轮", at: 1 },
          { id: "a1", role: "assistant", text: "完成", at: 2 },
        ],
      }),
    );

    const unbindAgain = store.bindStream();
    await vi.waitFor(() => expect(store.liveOf("c1")).toBeNull());
    expect(store.recordOf("c1")!.messages.map((item) => item.text)).toEqual(["跑一轮", "完成"]);
    unbindAgain();
  });

  it("bindStream 单例：多次挂载只订阅一次，全部卸载后退订", () => {
    const bridge = stubZen();
    const store = useSideChatStore();

    const offFirst = store.bindStream();
    const offSecond = store.bindStream();
    expect(bridge.onStream).toHaveBeenCalledTimes(1);

    offFirst();
    expect(bridge.handlers).toHaveLength(1);
    offSecond();
    expect(bridge.handlers).toHaveLength(0);
  });
});

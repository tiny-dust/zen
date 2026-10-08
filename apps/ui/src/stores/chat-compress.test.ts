import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import type { ChatMessage } from "@zen/shared";

import { COMPRESS_THRESHOLD, createCompressionDomain } from "@/stores/chat-compress";

const appendMessage = vi.fn(async () => undefined);

vi.mock("@/stores/session-info", () => ({
  useSessionInfoStore: () => ({
    activeTasks: [{ label: "修统计", done: true }],
  }),
}));

/** 10 条历史轮次 + 最后一条待发送的用户问询（prepareCompression 会把它排除在历史外） */
function conversation(): ChatMessage[] {
  const list: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: `消息 ${i} 的内容，用于压缩历史测试。`,
    createdAt: i,
  })) as ChatMessage[];
  list.push({
    id: "q",
    role: "user",
    content: "当前要发送的问题",
    createdAt: 10,
  } as ChatMessage);
  return list;
}

function domainOf(
  list: ChatMessage[],
  opts: { forceCompress?: boolean; usage?: number | null } = {},
) {
  const forceCompress = ref(opts.forceCompress ?? false);
  const statusText = ref("");
  const domain = createCompressionDomain({
    messages: ref(list),
    sessionId: ref("s1"),
    statusText,
    forceCompress,
    contextUsage: () => opts.usage ?? null,
  });
  return { domain, forceCompress, statusText };
}

beforeEach(() => {
  setActivePinia(createPinia());
  appendMessage.mockClear();
  vi.stubGlobal("zen", { session: { appendMessage } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createCompressionDomain.prepareCompression", () => {
  it("未触发时不压缩，历史只取待发送问题之前的部分", () => {
    const list = conversation();
    const { domain } = domainOf(list);
    const { historyTurns, compression } = domain.prepareCompression();
    expect(historyTurns).toHaveLength(10);
    expect(compression.compressed).toBe(false);
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("forceCompress 触发：折叠旧轮次、摘要卡插到当前问询之前", () => {
    const list = conversation();
    const { domain, forceCompress, statusText } = domainOf(list, { forceCompress: true });
    const { compression } = domain.prepareCompression();
    expect(compression.compressed).toBe(true);
    // 压缩成功后进入会话级压缩模式
    expect(forceCompress.value).toBe(true);
    expect(statusText.value).toBe("已压缩上下文 · Agent 思考中…");

    const cards = list.filter((item) => item.role === "tool");
    expect(cards).toHaveLength(1);
    expect((cards[0]?.meta as { toolName: string }).toolName).toBe("contextCompact");
    expect((cards[0]?.meta as { output?: string }).output).toBe(compression.summary);
    // 卡插在最后一条（当前问询）之前
    expect(list[list.length - 1]?.id).toBe("q");
    expect(list[list.length - 2]?.role).toBe("tool");
    // 落库
    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(appendMessage).toHaveBeenCalledWith("s1", cards[0]);
  });

  it("用量超阈值触发压缩并进入压缩模式", () => {
    const list = conversation();
    const { domain, forceCompress } = domainOf(list, { usage: COMPRESS_THRESHOLD + 1 });
    const { compression } = domain.prepareCompression();
    expect(compression.compressed).toBe(true);
    expect(forceCompress.value).toBe(true);
  });

  it("已有摘要卡也会持续折叠（防全量历史回灌）", () => {
    const list = conversation();
    list.splice(list.length - 1, 0, {
      id: "card",
      role: "tool",
      content: "",
      createdAt: 99,
      meta: { toolName: "contextCompact", output: "旧摘要" },
    } as ChatMessage);
    const { domain, forceCompress } = domainOf(list);
    const { compression } = domain.prepareCompression();
    expect(compression.compressed).toBe(true);
    expect(forceCompress.value).toBe(true);
  });

  it("摘要滚动更新时复用同一张卡，不重复插入", () => {
    const list = conversation();
    const { domain } = domainOf(list, { forceCompress: true });
    const first = domain.prepareCompression();
    const cards = () => list.filter((item) => item.role === "tool");
    expect(cards()).toHaveLength(1);
    const original = (cards()[0]?.meta as { output?: string }).output;
    expect(original).toBe(first.compression.summary);

    // 摘要内容相同：不更新也不追加
    domain.prepareCompression();
    expect(cards()).toHaveLength(1);

    // 改动更早轮次 → 摘要变化 → 更新同一张卡
    list[0] = { ...list[0]!, content: "改写后的最初目标描述。" } as ChatMessage;
    domain.prepareCompression();
    expect(cards()).toHaveLength(1);
    expect((cards()[0]?.meta as { output?: string }).output).not.toBe(original);
    // 更新旧卡时同步落库
    expect(appendMessage).toHaveBeenCalledTimes(2);
  });

  it("window.zen 缺失时只改本地状态，不落库", () => {
    vi.unstubAllGlobals();
    const list = conversation();
    const { domain } = domainOf(list, { forceCompress: true });
    const { compression } = domain.prepareCompression();
    expect(compression.compressed).toBe(true);
    expect(list.filter((item) => item.role === "tool")).toHaveLength(1);
    expect(appendMessage).not.toHaveBeenCalled();
  });
});

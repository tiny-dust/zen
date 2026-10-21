// 异常中心 store：refresh 排序 / analyze 写入 map / init 幂等订阅 / 清空与单删。
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ErrorReportAnalysis, ErrorReportRecord } from "@zen/shared";

import { buildFixPrompt, useErrorsStore } from "@/stores/errors";

function recordOf(id: string, patch: Partial<ErrorReportRecord> = {}): ErrorReportRecord {
  return {
    id,
    source: "renderer",
    kind: "window-error",
    message: `boom ${id}`,
    firstSeenAt: 1,
    lastSeenAt: 2,
    count: 1,
    ...patch,
  };
}

let changedHandlers: Array<() => void> = [];
const listMock = vi.fn(async (): Promise<ErrorReportRecord[]> => []);
const analyzeMock = vi.fn(async (): Promise<ErrorReportAnalysis | null> => null);
const clearMock = vi.fn(async () => ({ ok: true }));

function stubErrorsZen() {
  changedHandlers = [];
  listMock.mockReset();
  analyzeMock.mockReset();
  clearMock.mockReset();
  vi.stubGlobal("zen", {
    errors: {
      list: listMock,
      analyze: analyzeMock,
      clear: clearMock,
      onChanged: vi.fn((handler: () => void) => {
        changedHandlers.push(handler);
        return () => undefined;
      }),
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  stubErrorsZen();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useErrorsStore", () => {
  it("refresh 按 lastSeenAt 降序并置 loaded", async () => {
    listMock.mockResolvedValue([
      recordOf("old", { lastSeenAt: 100 }),
      recordOf("new", { lastSeenAt: 900 }),
      recordOf("mid", { lastSeenAt: 500 }),
    ]);
    const store = useErrorsStore();
    await store.refresh();
    expect(store.reports.map((item) => item.id)).toEqual(["new", "mid", "old"]);
    expect(store.loaded).toBe(true);
  });

  it("analyze 结果写入 analysisMap；不可判定（null）不落 map", async () => {
    const analysis: ErrorReportAnalysis = {
      softwareRelated: true,
      confidence: "high",
      reason: "堆栈指向 Zen 自身代码",
    };
    analyzeMock.mockResolvedValueOnce(analysis);
    const store = useErrorsStore();
    const result = await store.analyze("r1");
    expect(result).toEqual(analysis);
    expect(store.analysisMap["r1"]).toEqual(analysis);

    analyzeMock.mockResolvedValueOnce(null);
    expect(await store.analyze("r1")).toBeNull();
    expect(store.analysisMap["r1"]).toBeUndefined();
  });

  it("init 订阅变更广播且幂等，收到广播后自动 refresh", async () => {
    listMock.mockResolvedValue([recordOf("r1")]);
    const store = useErrorsStore();
    store.init();
    store.init();
    // onChanged 只绑一次
    expect(changedHandlers).toHaveLength(1);

    listMock.mockResolvedValue([recordOf("r1"), recordOf("r2", { lastSeenAt: 999 })]);
    changedHandlers[0]!();
    await Promise.resolve();
    expect(store.reports.map((item) => item.id)).toEqual(["r2", "r1"]);
  });

  it("clearAll 清空全部并刷新；removeOne 只清该条", async () => {
    listMock.mockResolvedValue([recordOf("r1"), recordOf("r2")]);
    const store = useErrorsStore();
    await store.refresh();

    listMock.mockResolvedValue([recordOf("r2")]);
    await store.removeOne("r1");
    expect(clearMock).toHaveBeenCalledWith(["r1"]);
    expect(store.reports.map((item) => item.id)).toEqual(["r2"]);

    listMock.mockResolvedValue([]);
    await store.clearAll();
    // clear() 不带参 = 清空全部
    expect(clearMock).toHaveBeenLastCalledWith();
    expect(store.reports).toHaveLength(0);
  });

  it("startFix 走 chat store 的 newTask + send(overrideText) 路径", async () => {
    const { useChatStore } = await import("@/stores/chat");
    const newTask = vi.fn(async () => undefined);
    const send = vi.fn(async (_overrideText?: string) => undefined);
    vi.spyOn(useChatStore(), "newTask").mockImplementation(newTask);
    vi.spyOn(useChatStore(), "send").mockImplementation(send);

    const store = useErrorsStore();
    store.analysisMap["r1"] = { softwareRelated: true, confidence: "low", reason: "疑似自身缺陷" };
    await store.startFix(recordOf("r1", { message: "TypeError: cannot read", count: 3, lastSeenAt: 1_000 }));
    expect(newTask).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    const prompt = send.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("diagnosing-bugs");
    expect(prompt).toContain("TypeError: cannot read");
    expect(prompt).toContain("渲染层");
    expect(prompt).toContain("出现次数：3");
    expect(prompt).toContain("疑似自身缺陷");
  });
});

describe("buildFixPrompt", () => {
  it("包含来源/类型/消息/次数/最近发生时间，stack 与分析可选", () => {
    const bare = buildFixPrompt(recordOf("r1"), null);
    expect(bare).toContain("boom r1");
    expect(bare).not.toContain("堆栈：");

    const full = buildFixPrompt(
      recordOf("r2", { stack: "at foo (bar.ts:1)", source: "main", kind: "uncaught" }),
      { softwareRelated: false, confidence: "high", reason: "网络环境问题" },
    );
    expect(full).toContain("堆栈：");
    expect(full).toContain("at foo (bar.ts:1)");
    expect(full).toContain("主进程");
    expect(full).toContain("网络环境问题");
  });
});

import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useExternalSessionsStore } from "./external-sessions";

import type {
  ExternalClientCapability,
  ExternalRunEvent,
  ExternalRunRequest,
  ExternalSessionSummary,
  ExternalSessionTrace,
} from "@zen/shared";

function summary(id: string, client: ExternalSessionSummary["client"] = "claude"): ExternalSessionSummary {
  return {
    id,
    client,
    sessionId: id.split(":")[1] ?? id,
    title: id,
    updatedAt: 1,
    status: "unverified",
    eventCount: 0,
    path: `/tmp/${id}.jsonl`,
  };
}

const CAPABILITIES: ExternalClientCapability[] = [
  { client: "claude", command: "claude", path: "/usr/local/bin/claude", resume: "supported" },
  { client: "codex", command: "codex", path: "/usr/local/bin/codex", resume: "supported" },
  { client: "gemini", command: "gemini", path: null, resume: "missing-cli" },
  { client: "dsh", command: "dsh", path: null, resume: "missing-cli" },
  { client: "grok", command: "grok", path: "/usr/local/bin/grok", resume: "unsupported" },
];

interface StubOptions {
  sessions?: ExternalSessionSummary[];
  trace?: (id: string) => Promise<ExternalSessionTrace>;
  send?: (request: ExternalRunRequest) => Promise<{ runId: string } | { error: string; blocked?: string }>;
  stop?: (runId: string) => Promise<{ ok: boolean }>;
}

/** 只替换 zen 通道，保留真实 window（替换整个 window 会丢掉 Event 等构造器） */
function stubZen(options: StubOptions = {}) {
  const handlers: Array<(event: ExternalRunEvent) => void> = [];
  // off 同时记录退订次数并真的把 handler 摘掉，便于断言「卸载后不再收事件」
  const off = vi.fn((handler: (event: ExternalRunEvent) => void) => {
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  });
  const send = vi.fn(options.send ?? (async () => ({ runId: "run-1" })));
  const stop = vi.fn(options.stop ?? (async () => ({ ok: true })));
  const api = {
    list: async () => ({
      sessions: options.sessions ?? [summary("claude:a"), summary("claude:b")],
      groups: [
        { client: "claude", detected: true, count: 2 },
        { client: "codex", detected: true, count: 0 },
      ],
      skipped: 0,
    }),
    trace:
      options.trace ??
      (async (id: string) => ({ id, events: [{ kind: "user" as const, text: "hi" }], truncated: false })),
    capabilities: async () => CAPABILITIES,
    send,
    stop,
    onRun: (handler: (event: ExternalRunEvent) => void) => {
      handlers.push(handler);
      return () => off(handler);
    },
  };
  (window as unknown as { zen: unknown }).zen = { externalSessions: api };
  function emit(event: ExternalRunEvent) {
    for (const handler of [...handlers]) {
      handler(event);
    }
  }
  return { send, stop, emit, off, handlers };
}

describe("外部会话 store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("快速切换会话时丢弃过期响应", async () => {
    let releaseA: ((value: ExternalSessionTrace) => void) | undefined;
    stubZen({
      trace: (id) => {
        if (id === "claude:a") {
          return new Promise((resolve) => {
            releaseA = resolve;
          });
        }
        return Promise.resolve({ id, events: [{ kind: "user", text: "B" }], truncated: false });
      },
    });

    const store = useExternalSessionsStore();
    await store.load();

    void store.select("claude:a");
    await store.select("claude:b");
    releaseA?.({ id: "claude:a", events: [{ kind: "user", text: "A" }], truncated: false });
    await Promise.resolve();

    expect(store.selectedId).toBe("claude:b");
    expect(store.trace).toHaveLength(1);
    expect(store.trace[0]?.text).toBe("B");
  });

  it("轨迹读取失败时保留错误信息，不当成空会话", async () => {
    stubZen({ trace: async (id) => ({ id, events: [], truncated: false, error: "EACCES" }) });

    const store = useExternalSessionsStore();
    await store.load();
    await store.select("claude:a");

    expect(store.traceError).toBe("EACCES");
    expect(store.trace).toHaveLength(0);
  });

  it("capabilities 决定能否续聊与禁用原因", async () => {
    stubZen({
      sessions: [summary("claude:a"), summary("gemini:g", "gemini"), summary("grok:x", "grok")],
    });
    const store = useExternalSessionsStore();
    await store.load();

    expect(store.capabilities).toHaveLength(5);
    expect(store.canResume("claude:a")).toBe(true);
    expect(store.resumeBlockedReason("claude:a")).toBeNull();

    expect(store.canResume("gemini:g")).toBe(false);
    expect(store.resumeBlockedReason("gemini:g")).toBe("missing-cli");
    expect(store.commandOf("gemini")).toBe("gemini");

    expect(store.canResume("grok:x")).toBe(false);
    expect(store.resumeBlockedReason("grok:x")).toBe("unsupported");

    expect(store.resumeBlockedReason("claude:missing")).toBe("unknown-session");
  });

  it("主进程给出的 resumable / resumeBlocked 优先于能力推断", async () => {
    // 共享类型暂未声明这两个可选字段：按主进程实际附加的形状写入
    const blocked = Object.assign(summary("claude:a"), {
      resumable: false,
      resumeBlocked: "unknown-session",
    });
    const supported = Object.assign(summary("grok:x", "grok"), { resumable: true });
    stubZen({ sessions: [blocked, supported] });
    const store = useExternalSessionsStore();
    await store.load();

    expect(store.canResume("claude:a")).toBe(false);
    expect(store.resumeBlockedReason("claude:a")).toBe("unknown-session");
    expect(store.canResume("grok:x")).toBe(true);
  });

  it("发送后 delta 累加，done 后用权威记录替换本地气泡", async () => {
    let traceCalls = 0;
    const { send, emit } = stubZen({
      sessions: [summary("claude:a")],
      trace: async (id) => {
        traceCalls += 1;
        return {
          id,
          events:
            traceCalls === 1
              ? [{ kind: "user" as const, text: "old" }]
              : [
                  { kind: "user" as const, text: "old" },
                  { kind: "user" as const, text: "hello" },
                  { kind: "assistant" as const, text: "Hello!" },
                ],
          truncated: false,
        };
      },
    });
    const store = useExternalSessionsStore();
    await store.load();
    await store.select("claude:a");

    const result = await store.send("  hello  ");

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledWith({ id: "claude:a", message: "hello" });
    expect(store.activeRun?.userText).toBe("hello");

    emit({ id: "claude:a", runId: "run-1", type: "delta", text: "Hel" });
    emit({ id: "claude:a", runId: "run-1", type: "delta", text: "lo!" });
    expect(store.activeRun?.assistantText).toBe("Hello!");

    emit({ id: "claude:a", runId: "run-1", type: "done" });
    await flushPromises();

    expect(store.run).toBeNull();
    expect(store.trace.map((event) => event.text)).toContain("Hello!");
  });

  it("error 把原文交还输入框并保留错误气泡", async () => {
    const { emit } = stubZen();
    const store = useExternalSessionsStore();
    await store.load();
    await store.select("claude:a");

    await store.send("修复这个 bug");
    emit({ id: "claude:a", runId: "run-1", type: "error", error: "CLI exited 1" });

    expect(store.activeRun?.error).toBe("CLI exited 1");
    expect(store.activeRun?.running).toBe(false);
    expect(store.restoreDraft?.text).toBe("修复这个 bug");

    store.clearRestoreDraft();
    expect(store.restoreDraft).toBeNull();
  });

  it("stopped 保留已输出内容；dispose 后退订不再接收事件", async () => {
    const { emit, off } = stubZen();
    const store = useExternalSessionsStore();
    await store.load();
    await store.select("claude:a");

    await store.send("继续");
    emit({ id: "claude:a", runId: "run-1", type: "delta", text: "部分输出" });
    emit({ id: "claude:a", runId: "run-1", type: "stopped" });

    expect(store.activeRun?.stopped).toBe(true);
    expect(store.activeRun?.assistantText).toBe("部分输出");

    store.dispose();
    expect(off).toHaveBeenCalledTimes(1);
    emit({ id: "claude:a", runId: "run-1", type: "delta", text: "不会到达" });
    expect(store.run?.assistantText).toBe("部分输出");
  });

  it("切走会话后流式气泡只属于原会话", async () => {
    const { emit } = stubZen();
    const store = useExternalSessionsStore();
    await store.load();
    await store.select("claude:a");

    await store.send("只发在 a");

    await store.select("claude:b");
    expect(store.activeRun).toBeNull();
    expect(store.runningId).toBe("claude:a");

    await store.select("claude:a");
    expect(store.activeRun?.userText).toBe("只发在 a");

    emit({ id: "claude:a", runId: "run-1", type: "delta", text: "回来还能看到" });
    expect(store.activeRun?.assistantText).toBe("回来还能看到");
  });
});

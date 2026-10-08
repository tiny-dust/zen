import { afterEach, describe, expect, it, vi } from "vitest";

import { runMockAgent } from "./mock-agent";

import type { AgentStreamEvent } from "@zen/shared";

/**
 * 免配置 mock 运行（本地演示 / 无 key 兜底）：
 * - 未中断：status(thinking) → 逐字 delta → done(stop)
 * - 启动前已 abort：直接 done(cancelled)，不产生 delta
 * - 流中途 abort：立即收尾 done(cancelled)
 */

afterEach(() => {
  vi.useRealTimers();
});

function collect(): { events: AgentStreamEvent[]; emit: (event: AgentStreamEvent) => void } {
  const events: AgentStreamEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

describe("runMockAgent", () => {
  it("逐字输出回复并以 done(stop) 收尾", async () => {
    vi.useFakeTimers();
    const { events, emit } = collect();
    const controller = new AbortController();

    const running = runMockAgent("sess-mock", "你好", controller.signal, emit);
    await vi.advanceTimersByTimeAsync(16 * 500);
    await running;

    expect(events[0]).toMatchObject({ type: "status", status: "thinking" });
    const deltas = events.filter((event) => event.type === "delta");
    const text = deltas.map((event) => (event.type === "delta" ? event.text : "")).join("");
    expect(text).toContain("你好");
    expect(deltas.length).toBe(text.length);
    expect(events.at(-1)).toMatchObject({ type: "done", reason: "stop" });
  });

  it("启动前已取消则直接 done(cancelled)", async () => {
    const { events, emit } = collect();
    const controller = new AbortController();
    controller.abort();

    await runMockAgent("sess-mock", "hi", controller.signal, emit);

    expect(events).toEqual([{ type: "done", sessionId: "sess-mock", reason: "cancelled" }]);
  });

  it("输出途中取消立即 done(cancelled)", async () => {
    vi.useFakeTimers();
    const { events, emit } = collect();
    const controller = new AbortController();

    const running = runMockAgent("sess-mock", "hello", controller.signal, emit);
    await vi.advanceTimersByTimeAsync(16 * 3);
    controller.abort();
    await vi.advanceTimersByTimeAsync(16 * 500);
    await running;

    expect(events.at(-1)).toMatchObject({ type: "done", reason: "cancelled" });
    expect(events.some((event) => event.type === "delta")).toBe(true);
  });
});

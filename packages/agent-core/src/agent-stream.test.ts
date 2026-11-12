import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentStreamEvent } from "@zen/shared";

import { processStreamPart } from "./agent-stream";
import type { StreamPart, StreamPartState } from "./agent-stream";

afterEach(() => vi.useRealTimers());

describe("processStreamPart 思考计时", () => {
  it("相邻两轮思考分别从各自起点计时，正文与工具也会结束当前段", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const events: AgentStreamEvent[] = [];
    const state: StreamPartState = {
      step: 0, finishReason: null, lastStepHadToolCalls: false,
      approvalRequested: false, streamError: null, hasText: false, lastInputTokens: null,
      reasoningStartedAt: null, reasoningHasContent: false,
    };
    const ctx = {
      sessionId: "s",
      emit: (event: AgentStreamEvent) => events.push(event),
      openTools: new Map<string, string>(),
      state,
      setPendingApproval: () => undefined,
    };
    const send = (part: StreamPart) => processStreamPart(part, ctx);

    send({ type: "reasoning-start", id: "r1" } as StreamPart);
    vi.advanceTimersByTime(3000);
    send({ type: "reasoning-delta", id: "r1", text: "first" } as StreamPart);
    vi.advanceTimersByTime(2000);
    send({ type: "reasoning-end", id: "r1" } as StreamPart);
    vi.advanceTimersByTime(10000);
    send({ type: "reasoning-start", id: "r2" } as StreamPart);
    vi.advanceTimersByTime(4000);
    send({ type: "reasoning-delta", id: "r2", text: "second" } as StreamPart);
    vi.advanceTimersByTime(1000);
    send({ type: "text-delta", id: "text", text: "answer" } as StreamPart);

    expect(events.filter((event) => event.type === "reasoning_end")).toEqual([
      { type: "reasoning_end", sessionId: "s", durationMs: 5000 },
      { type: "reasoning_end", sessionId: "s", durationMs: 5000 },
    ]);
  });

  it("缺少 reasoning-start/end 时从首个文本计时，在工具开始时结算且不重复结算", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const events: AgentStreamEvent[] = [];
    const ctx = {
      sessionId: "s",
      emit: (event: AgentStreamEvent) => events.push(event),
      openTools: new Map<string, string>(),
      state: {
        step: 0, finishReason: null, lastStepHadToolCalls: false,
        approvalRequested: false, streamError: null, hasText: false, lastInputTokens: null,
        reasoningStartedAt: null, reasoningHasContent: false,
      } satisfies StreamPartState,
      setPendingApproval: () => undefined,
    };
    processStreamPart({ type: "reasoning-delta", id: "r", text: "thinking" } as StreamPart, ctx);
    vi.advanceTimersByTime(2500);
    processStreamPart({ type: "tool-input-start", id: "t", toolCallId: "t", toolName: "readFile" } as StreamPart, ctx);
    processStreamPart({ type: "reasoning-end", id: "r" } as StreamPart, ctx);
    expect(events.filter((event) => event.type === "reasoning_end")).toEqual([
      { type: "reasoning_end", sessionId: "s", durationMs: 2500 },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { sessionMetrics } from "@/lib/session-metrics";

import type { ChatMessage } from "@zen/shared";

function message(
  role: ChatMessage["role"],
  createdAt: number,
  parts?: ChatMessage["parts"],
): ChatMessage {
  return { id: `${role}-${createdAt}`, role, content: "", createdAt, parts };
}

describe("sessionMetrics", () => {
  it("统计轮数、工具数与会话跨度", () => {
    const metrics = sessionMetrics({
      messages: [
        message("user", 1_000),
        message("assistant", 31_000, [
          { type: "tool", toolCallId: "t1", toolName: "readFile", state: "ok" },
          { type: "tool", toolCallId: "t2", toolName: "editFile", state: "error" },
        ]),
        message("assistant", 91_000),
      ],
      inputTokens: 100,
      outputTokens: 20,
      cacheHitRate: null,
    });
    expect(metrics.rounds).toBe(1);
    expect(metrics.tools).toBe(2);
    expect(metrics.elapsedMs).toBe(90_000);
    expect(metrics.tests).toBe("none");
    expect(metrics.inputTokens).toBe(100);
  });

  it("最后一条测试命令决定 tests 状态", () => {
    const pass = sessionMetrics({
      messages: [
        message("user", 0),
        message("assistant", 10, [
          { type: "tool", toolCallId: "t1", toolName: "runTerminal", state: "ok", args: { command: "pnpm test" } },
        ]),
      ],
      inputTokens: null,
      outputTokens: null,
      cacheHitRate: null,
    });
    expect(pass.tests).toBe("pass");

    const fail = sessionMetrics({
      messages: [
        message("user", 0),
        message("assistant", 10, [
          { type: "tool", toolCallId: "t1", toolName: "runTerminal", state: "ok", args: { command: "npm test" } },
          { type: "tool", toolCallId: "t2", toolName: "runTerminal", state: "error", args: { command: "npm test" } },
        ]),
      ],
      inputTokens: null,
      outputTokens: null,
      cacheHitRate: null,
    });
    expect(fail.tests).toBe("fail");
  });

  it("空会话返回零值", () => {
    const metrics = sessionMetrics({
      messages: [],
      inputTokens: null,
      outputTokens: null,
      cacheHitRate: null,
    });
    expect(metrics).toEqual({
      rounds: 0,
      tools: 0,
      elapsedMs: 0,
      tests: "none",
      inputTokens: null,
      outputTokens: null,
      cacheHitRate: null,
    });
  });
});

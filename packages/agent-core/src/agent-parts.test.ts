import { describe, expect, it } from "vitest";

import {
  argsFromPart,
  errorMessage,
  isFailedToolOutput,
  MAX_RUN_STEPS,
  outputFromPart,
  partText,
  summarizeToolOutput,
  toolIdFromPart,
  toolNameFromPart,
  usageFromPart,
  uuidLike,
} from "./agent-parts";

/**
 * 流 part 解析纯函数：字段优先级、缺省兜底、usage 缺失字段回退。
 */

describe("part 解析", () => {
  it("partText 取 text/delta 兜底空串", () => {
    expect(partText({ text: "a" })).toBe("a");
    expect(partText({ delta: "b" })).toBe("b");
    expect(partText({})).toBe("");
  });

  it("toolName / toolId / args / output 兼容多种 part 形状", () => {
    expect(toolNameFromPart({ toolName: "x" })).toBe("x");
    expect(toolNameFromPart({ toolCall: { toolName: "y" } })).toBe("y");
    expect(toolNameFromPart({})).toBe("unknown");

    expect(toolIdFromPart({ id: "1" })).toBe("1");
    expect(toolIdFromPart({ toolCallId: "2" })).toBe("2");
    expect(toolIdFromPart({ toolCall: { toolCallId: "3" } })).toBe("3");
    expect(toolIdFromPart({})).toBe("");

    expect(argsFromPart({ toolCall: { input: { a: 1 } } })).toEqual({ a: 1 });
    expect(argsFromPart({ toolCall: { args: { b: 2 } } })).toEqual({ b: 2 });
    expect(argsFromPart({ input: { c: 3 } })).toEqual({ c: 3 });

    expect(outputFromPart({ output: "o" })).toBe("o");
    expect(outputFromPart({ result: "r" })).toBe("r");
    expect(outputFromPart({})).toBeUndefined();
  });

  it("summarizeToolOutput 覆盖字符串 / path / 失败输出 / 兜底", () => {
    expect(summarizeToolOutput({ output: "short" })).toBe("short");
    expect(summarizeToolOutput({ output: "x".repeat(200) })).toBe(`${"x".repeat(120)}…`);
    expect(summarizeToolOutput({ output: { path: "/tmp/a.txt" } })).toBe("/tmp/a.txt");
    expect(summarizeToolOutput({ output: { ok: false, output: "失败详情" } })).toBe("失败详情");
    expect(summarizeToolOutput({ output: { ok: false, output: "y".repeat(200) } })).toBe(
      `${"y".repeat(120)}…`,
    );
    expect(summarizeToolOutput({ output: 42 })).toBe("工具执行完成");
    expect(summarizeToolOutput({})).toBe("工具执行完成");
  });

  it("isFailedToolOutput 只认 ok=false 且 output 为字符串", () => {
    expect(isFailedToolOutput({ ok: false, output: "e" })).toBe(true);
    expect(isFailedToolOutput({ ok: true, output: "e" })).toBe(false);
    expect(isFailedToolOutput({ ok: false, output: 1 })).toBe(false);
    expect(isFailedToolOutput(null)).toBe(false);
    expect(isFailedToolOutput("s")).toBe(false);
  });

  it("errorMessage 覆盖 Error / 字符串 / 其它", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("raw")).toBe("raw");
    expect(errorMessage({})).toBe("Agent 执行失败");
  });

  it("usageFromPart 缺字段回退 totalUsage，全缺返回 null", () => {
    expect(usageFromPart({ usage: { inputTokens: 3, outputTokens: 4 } })).toEqual({
      inputTokens: 3,
      outputTokens: 4,
    });
    expect(usageFromPart({ usage: { inputTokens: null }, totalUsage: { inputTokens: 7 } })).toEqual({
      inputTokens: 7,
      outputTokens: 0,
    });
    expect(usageFromPart({ usage: { inputTokens: 1, outputTokens: null } })).toEqual({
      inputTokens: 1,
      outputTokens: 0,
    });
    expect(usageFromPart({ usage: {} })).toBeNull();
    expect(usageFromPart({})).toBeNull();
  });

  it("uuidLike 生成互不相同的短 id；MAX_RUN_STEPS 为正整数", () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuidLike()));
    expect(ids.size).toBe(200);
    expect(Number.isInteger(MAX_RUN_STEPS)).toBe(true);
    expect(MAX_RUN_STEPS).toBeGreaterThan(0);
  });
});

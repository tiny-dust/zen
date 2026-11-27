import { describe, expect, it } from "vitest";

import type { ChatMessage, ChatMessagePart } from "@zen/shared";

import { buildTraceDocument } from "./document";
import {
  computeTraceInsights,
  extractThinkingChain,
  filterTraceDocument,
  highlightSegments,
} from "./queries";

function fixture(): ChatMessage[] {
  const parts: ChatMessagePart[] = [
    { type: "reasoning", text: "先读文件，再跑测试。", ms: 2_400 },
    { type: "tool", toolCallId: "c1", toolName: "readFile", state: "ok", args: { path: "src/a.ts" }, summary: "读取成功" },
    { type: "reasoning", text: "还要跑一下 lint 看看。", ms: 800 },
    { type: "tool", toolCallId: "c2", toolName: "runTerminal", state: "error", args: { command: "pnpm lint" }, error: "exit code 1" },
  ];
  return [
    { id: "u1", role: "user", content: "帮我修一下 a.ts", createdAt: 1_000 },
    {
      id: "a1",
      role: "assistant",
      content: "改好了",
      createdAt: 1_000,
      parts,
      meta: {
        run: {
          startedAt: 1_000,
          endedAt: 11_000,
          status: "idle",
          usage: { inputTokens: 2_000, outputTokens: 400 },
        },
      },
    },
  ];
}

describe("filterTraceDocument", () => {
  it("按空格拆词做 AND 检索，大小写不敏感", () => {
    const doc = buildTraceDocument(fixture());

    const hit = filterTraceDocument(doc, { query: "PNPM lint", kind: "all" });
    expect(hit.active).toBe(true);
    expect(hit.orderedMatches).toHaveLength(1);
    expect(doc.nodesById[hit.orderedMatches[0] ?? ""]?.call?.name).toBe("runTerminal");

    const miss = filterTraceDocument(doc, { query: "pnpm missing", kind: "all" });
    expect(miss.orderedMatches).toHaveLength(0);
  });

  it("类型过滤：思考 / 工具 / 仅失败 / 慢步骤", () => {
    const doc = buildTraceDocument(fixture());

    expect(filterTraceDocument(doc, { query: "", kind: "thinking" }).orderedMatches).toHaveLength(2);
    expect(filterTraceDocument(doc, { query: "", kind: "tool" }).orderedMatches).toHaveLength(2);
    expect(filterTraceDocument(doc, { query: "", kind: "error" }).orderedMatches).toHaveLength(1);

    const slow = filterTraceDocument(doc, { query: "", kind: "slow" });
    expect(slow.orderedMatches).toHaveLength(1);
    expect(doc.nodesById[slow.orderedMatches[0] ?? ""]?.durationMs).toBe(2_400);

    expect(filterTraceDocument(doc, { query: "", kind: "all" }).active).toBe(false);
  });
});

describe("extractThinkingChain", () => {
  it("每段思考挂上它之后触发的操作，下一段思考处截止", () => {
    const doc = buildTraceDocument(fixture());
    const chain = extractThinkingChain(doc);

    expect(chain).toHaveLength(2);
    expect(chain.map((item) => item.stepIndex)).toEqual([1, 2]);
    expect(chain[0]?.triggeredActions).toHaveLength(1);
    expect(chain[0]?.triggeredActions[0]?.call?.name).toBe("readFile");
    expect(chain[1]?.triggeredActions[0]?.status).toBe("error");
    expect(chain[0]?.turn.index).toBe(1);
    expect(chain[0]?.lane.id).toBe("main");
  });

  it("带过滤结果时只保留命中的思考段", () => {
    const doc = buildTraceDocument(fixture());
    const filter = filterTraceDocument(doc, { query: "lint", kind: "all" });
    const chain = extractThinkingChain(doc, filter);

    expect(chain).toHaveLength(1);
    // 步骤号按过滤后的顺序重排（与 Nomi 一致）
    expect(chain[0]?.stepIndex).toBe(1);
    expect(chain[0]?.node.text).toContain("lint");
  });
});

describe("computeTraceInsights", () => {
  it("思考时长求和，其余落在生成与等待，工具分布按调用次数排序", () => {
    const doc = buildTraceDocument(fixture());
    const insights = computeTraceInsights(doc);

    expect(insights.thinkingMs).toBe(3_200);
    expect(insights.toolMs).toBe(0);
    // Zen 没有子代理与网关数据
    expect(insights.subagentMs).toBe(0);
    expect(insights.requestMs).toBe(0);
    expect(insights.totalMs).toBe(10_000);
    expect(insights.otherMs).toBe(6_800);
    expect(insights.slowest[0]?.durationMs).toBe(2_400);
    expect(insights.failed).toHaveLength(1);
    expect(insights.toolDistribution.map((item) => item.name).sort()).toEqual([
      "readFile",
      "runTerminal",
    ]);
  });
});

describe("highlightSegments", () => {
  it("按词高亮，非命中片段原样返回", () => {
    expect(highlightSegments("pnpm lint 失败", "lint")).toEqual([
      { text: "pnpm ", hit: false },
      { text: "lint", hit: true },
      { text: " 失败", hit: false },
    ]);
    expect(highlightSegments("no query", "")).toEqual([{ text: "no query", hit: false }]);
  });
});

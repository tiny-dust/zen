import { describe, expect, it } from "vitest";

import {
  CONTEXT_OVERHEAD_TOKENS,
  compressHistory,
  estimateHistoryTokens,
  estimateTokens,
} from "./chat-types";
import type { ChatTurn } from "@zen/shared";

function turns(n: number): ChatTurn[] {
  const list: ChatTurn[] = [];
  for (let i = 0; i < n; i += 1) {
    list.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `第 ${i} 条消息内容，用于压缩测试。`,
    });
  }
  return list;
}

const baseOpts = {
  tasks: [],
  touchedFiles: [],
  uploads: [],
  force: false,
  overThreshold: false,
};

describe("estimateTokens", () => {
  it("空串为 0，中英混合按字种粗估", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello")).toBeGreaterThan(0);
    const cjk = estimateTokens("上下文压缩测试");
    const latin = estimateTokens("abcdefgh");
    expect(cjk).toBeGreaterThan(0);
    expect(latin).toBeGreaterThan(0);
  });

  it("estimateHistoryTokens 含固定系统/工具开销", () => {
    const empty = estimateHistoryTokens([]);
    expect(empty).toBe(CONTEXT_OVERHEAD_TOKENS);
    const withTurns = estimateHistoryTokens(turns(3));
    expect(withTurns).toBeGreaterThan(empty);
  });
});

describe("compressHistory", () => {
  it("短会话或未触发时原样返回", () => {
    const history = turns(4);
    expect(compressHistory(history, { ...baseOpts, force: true })).toMatchObject({
      compressed: false,
      turns: history,
      summary: "",
      compactedCount: 0,
    });
    expect(compressHistory(turns(10), baseOpts)).toMatchObject({ compressed: false });
  });

  it("force 或 overThreshold 触发：history 变短，摘要完整可读", () => {
    const history = turns(12);
    const byForce = compressHistory(history, { ...baseOpts, force: true });
    expect(byForce.compressed).toBe(true);
    expect(byForce.compactedCount).toBe(6);
    // 摘要 + 最近 6 条，远短于 12
    expect(byForce.turns).toHaveLength(7);
    expect(byForce.turns.length).toBeLessThan(history.length);
    // 摘要走 system 轮，不与真实用户消息混淆
    expect(byForce.turns[0]?.role).toBe("system");
    expect(byForce.summary).toContain("会话摘要");
    expect(byForce.summary).toContain("目标：");
    expect(byForce.summary).toContain("用户此前的要求：");
    expect(byForce.summary).toContain("第 0 条消息内容");
    expect(byForce.turns[0]?.content).toBe(byForce.summary);

    const byThreshold = compressHistory(history, { ...baseOpts, overThreshold: true });
    expect(byThreshold.compressed).toBe(true);
    expect(byThreshold.turns).toHaveLength(7);
  });

  it("摘要含任务进度与读写文件，便于恢复上下文", () => {
    const history = turns(10);
    const result = compressHistory(history, {
      tasks: [{ label: "修统计", done: true }],
      touchedFiles: ["apps/ui/src/stores/chat.ts"],
      uploads: ["spec.md"],
      force: true,
      overThreshold: false,
    });
    expect(result.summary).toContain("任务进度：");
    expect(result.summary).toContain("- [x] 修统计");
    expect(result.summary).toContain("apps/ui/src/stores/chat.ts");
    expect(result.summary).toContain("spec.md");
    // 最近 6 条原文保留
    const recent = result.turns.slice(1);
    expect(recent).toEqual(history.slice(-6));
  });
});

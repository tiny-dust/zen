import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@zen/shared";

import { SubAgentTranscript } from "./sub-agent-transcript";

/** 子 Agent 消息流收集器回归：delta 合并 / 工具生命周期 / ask / 错误 / 限量截断 */

function delta(text: string): AgentStreamEvent {
  return { type: "delta", sessionId: "p::a", text };
}

describe("SubAgentTranscript", () => {
  it("连续 delta 合并进同一条 text 条目，工具调用打断后另起一条", () => {
    const t = new SubAgentTranscript();
    t.push(delta("第一段"));
    t.push(delta("正文"));
    t.push({ type: "tool_start", sessionId: "p::a", toolCallId: "t1", toolName: "readFile", args: { path: "a.ts" } });
    t.push(delta("第二段"));
    t.push(delta("正文"));

    const snap = t.snapshot();
    expect(snap.map((e) => e.kind)).toEqual(["text", "tool", "text"]);
    expect(snap[0]?.text).toBe("第一段正文");
    expect(snap[1]).toMatchObject({ kind: "tool", toolName: "readFile", state: "running" });
    expect(snap[1]?.args).toEqual({ path: "a.ts" });
    expect(snap[2]?.text).toBe("第二段正文");
  });

  it("tool_end 按 toolCallId 回写状态 / 摘要 / 输出尾部", () => {
    const t = new SubAgentTranscript();
    t.push({ type: "tool_start", sessionId: "p::a", toolCallId: "t1", toolName: "runTerminal", args: { command: "pnpm test" } });
    t.push({ type: "tool_progress", sessionId: "p::a", event: { toolCallId: "t1", toolName: "runTerminal", message: "运行中 50%" } });
    t.push({
      type: "tool_end",
      sessionId: "p::a",
      toolCallId: "t1",
      toolName: "runTerminal",
      ok: true,
      summary: "测试通过",
      output: "218 passed",
    });

    const [entry] = t.snapshot();
    expect(entry).toMatchObject({
      kind: "tool",
      state: "ok",
      summary: "测试通过",
      output: "218 passed",
    });
  });

  it("失败的 tool_end 把摘要写入 text（面板直读）并标记 error", () => {
    const t = new SubAgentTranscript();
    t.push({ type: "tool_start", sessionId: "p::a", toolCallId: "t9", toolName: "writeFile", args: {} });
    t.push({ type: "tool_end", sessionId: "p::a", toolCallId: "t9", toolName: "writeFile", ok: false, summary: "磁盘已满" });
    const [entry] = t.snapshot();
    expect(entry?.state).toBe("error");
    expect(entry?.text).toBe("磁盘已满");
  });

  it("ask_user / ask_resolved 记为 ask 条目，error 记为 error 条目", () => {
    const t = new SubAgentTranscript();
    t.push({ type: "ask_user", sessionId: "p::a", question: { askId: "q1", question: "用哪种方案？", options: [] } } as never);
    t.push({ type: "ask_resolved", sessionId: "p::a", askId: "q1", toolCallId: "", answer: "方案 A" });
    t.push({ type: "error", sessionId: "p::a", message: "模型超时" });
    const snap = t.snapshot();
    expect(snap.map((e) => e.kind)).toEqual(["ask", "ask", "error"]);
    expect(snap[0]?.text).toContain("用哪种方案");
    expect(snap[1]?.text).toBe("回答：方案 A");
  });

  it("条目超限时优先丢弃最老的 text/reasoning，保留工具与错误", () => {
    const t = new SubAgentTranscript();
    t.push(delta("开头正文"));
    for (let i = 0; i < 320; i += 1) {
      t.push({ type: "tool_start", sessionId: "p::a", toolCallId: `t${i}`, toolName: "readFile", args: { i } });
      t.push({ type: "tool_end", sessionId: "p::a", toolCallId: `t${i}`, toolName: "readFile", ok: true, summary: "ok" });
    }
    const snap = t.snapshot();
    expect(snap.length).toBeLessThanOrEqual(300);
    expect(snap.some((e) => e.text === "开头正文")).toBe(false);
    // 最新的工具仍在
    expect(snap.at(-1)).toMatchObject({ kind: "tool", toolName: "readFile" });
  });

  it("超长正文与入参被截断，revision 反映变更", () => {
    const t = new SubAgentTranscript();
    const before = t.revision;
    t.push(delta("x".repeat(25_000)));
    t.push({ type: "tool_start", sessionId: "p::a", toolCallId: "t1", toolName: "runTerminal", args: { command: "y".repeat(2_000) } });
    const snap = t.snapshot();
    expect(snap[0]?.text.length).toBeLessThan(25_000);
    expect(snap[0]?.text.endsWith("…（已截断）")).toBe(true);
    expect(JSON.stringify(snap[1]?.args).length).toBeLessThan(2_000);
    expect(t.revision).toBeGreaterThan(before);
  });
});

import { describe, expect, it } from "vitest";

import { groupMessageParts, groupTimelineMessages, summarizeTools } from "./message-groups";
import type { ToolPart } from "./tool-part";
import type { ChatMessage, ChatMessagePart } from "@zen/shared";

function tool(id: string, toolName = "readFile", state: ToolPart["state"] = "ok"): ToolPart {
  return { type: "tool", toolCallId: id, toolName, state };
}

function legacy(id: string): ChatMessage {
  return { id, role: "tool", content: "已读取", createdAt: 1, meta: { toolName: "readFile", ok: true } };
}

describe("groupMessageParts", () => {
  it("combines consecutive mixed tools without crossing text or reasoning boundaries", () => {
    const parts: ChatMessagePart[] = [
      { type: "reasoning", text: "inspect" }, tool("a"), tool("b", "runTerminal"),
      { type: "text", text: "update" }, tool("c", "loadSkill"),
      { type: "reasoning", text: "next step" }, tool("d", "webSearch"),
    ];
    const groups = groupMessageParts(parts);
    expect(groups.map((group) => group.type)).toEqual(["reasoning", "tools", "text", "tools", "reasoning", "tools"]);
    expect(groups[1]).toMatchObject({ index: 1, tools: [parts[1], parts[2]] });
    expect(parts).toHaveLength(7);
    expect(groupMessageParts([])).toEqual([]);
  });

  it("keeps the group key stable as streaming adds tools and preserves live tool identity", () => {
    const parts: ChatMessagePart[] = [tool("a", "runTerminal", "running")];
    const first = groupMessageParts(parts)[0];
    parts.push(tool("b"));
    const next = groupMessageParts(parts)[0];
    expect(next?.key).toBe(first?.key);
    if (next?.type === "tools") expect(next.tools[0]).toBe(parts[0]);
  });
});

describe("groupTimelineMessages", () => {
  it("groups legacy tools but never crosses user, assistant, or system messages", () => {
    const groups = groupTimelineMessages([
      legacy("1"), legacy("2"),
      { id: "u", role: "user", content: "next", createdAt: 2 }, legacy("3"),
      { id: "s", role: "system", content: "notice", createdAt: 3 }, legacy("4"),
    ]);
    expect(groups.map((group) => group.type)).toEqual(["tools", "message", "tools", "message", "tools"]);
    expect(groups[0]).toMatchObject({ tools: [{ toolCallId: "1" }, { toolCallId: "2" }] });
  });

  it("retains interrupted legacy states and malformed records", () => {
    const message = legacy("1");
    message.meta = { toolName: "runTerminal", ok: false, state: "interrupted", summary: "connection lost" };
    expect(groupTimelineMessages([message])[0]).toMatchObject({ tools: [{ state: "interrupted", error: "connection lost" }] });
    const malformed: ChatMessage = { id: "2", role: "tool", content: "old format", createdAt: 1 };
    expect(groupTimelineMessages([malformed])[0]).toMatchObject({ type: "message", message: malformed });
  });
});

describe("summarizeTools", () => {
  it("counts actions and preserves every non-success state in collapsed summaries", () => {
    const summary = summarizeTools([
      tool("a"), tool("b"), tool("c", "runTerminal", "running"),
      tool("d", "loadSkill", "error"), tool("e", "writeFile", "denied"),
      tool("f", "editFile", "awaiting-approval"), tool("g", "webSearch", "cancelled"),
    ]);
    expect(summary.label).toContain("读取文件 2");
    expect(summary.active).toBe(true);
    expect(summary.states.map((state) => state.label)).toEqual(["待审批 1", "执行中 1", "失败 1", "已拒绝 1", "已取消 1", "完成 2"]);
  });
});

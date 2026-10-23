import { describe, expect, it } from "vitest";

import type { ModelMessage } from "ai";

import { sanitizePersistedModelHistory } from "./model-history";

function user(text: string): ModelMessage {
  return { role: "user", content: text };
}

function assistantText(text: string): ModelMessage {
  return { role: "assistant", content: text };
}

function assistantCall(id: string): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: id, toolName: "updateTasks", input: {} }],
  };
}

function toolResult(id: string): ModelMessage {
  return {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: id, toolName: "updateTasks", output: { type: "text", value: "ok" } },
    ],
  };
}

function approvalResponse(): ModelMessage {
  return {
    role: "tool",
    content: [{ type: "tool-approval-response", approvalId: "appr_1", approved: true }],
  };
}

describe("sanitizePersistedModelHistory", () => {
  it("完整历史原样保留（含工具调用/结果/审批响应）", () => {
    const messages = [
      user("第一问"),
      assistantCall("call_1"),
      toolResult("call_1"),
      approvalResponse(),
      assistantText("第一答"),
    ];
    expect(sanitizePersistedModelHistory(messages)).toEqual(messages);
  });

  it("尾部悬空工具调用被截断（取消残留）", () => {
    const messages = [user("问"), assistantText("答"), assistantCall("call_dangle")];
    const sanitized = sanitizePersistedModelHistory(messages);
    expect(sanitized).toEqual([user("问"), assistantText("答")]);
  });

  it("悬空调用后跟插入消息时整体截断（不产出非法消息序）", () => {
    const messages = [
      user("原任务"),
      assistantCall("call_dangle"),
      user("插入的消息"),
      assistantText("插入回复"),
    ];
    const sanitized = sanitizePersistedModelHistory(messages);
    expect(sanitized).toEqual([user("原任务")]);
  });

  it("审批响应可解悬空调用（approve 后取消的场景不截断）", () => {
    const messages = [user("问"), assistantCall("call_1"), approvalResponse()];
    expect(sanitizePersistedModelHistory(messages)).toEqual(messages);
  });

  it("孤儿 tool 消息（无前置调用）被丢弃", () => {
    const messages = [toolResult("call_orphan"), user("问"), assistantText("答")];
    expect(sanitizePersistedModelHistory(messages)).toEqual([user("问"), assistantText("答")]);
  });

  it("部分结果未齐的调用簇整体截断", () => {
    const multiCall: ModelMessage = {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "call_a", toolName: "readFile", input: {} },
        { type: "tool-call", toolCallId: "call_b", toolName: "writeFile", input: {} },
      ],
    };
    const messages = [user("问"), multiCall, toolResult("call_a")];
    expect(sanitizePersistedModelHistory(messages)).toEqual([user("问")]);
  });
});

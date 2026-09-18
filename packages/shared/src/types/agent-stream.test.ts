import { describe, expect, it } from "vitest";

import type { AgentStreamEvent, ChatMessage } from "./agent";
import {
  applyStreamToMessage,
  applyStreamToParts,
  decodeChatMessageMeta,
  encodeChatMessageMeta,
  getMessageRun,
  restoreRunSummaryFromMessages,
  shouldPersistAssistantMessage,
} from "./agent";

function emptyMessage(): ChatMessage {
  return { id: "m1", role: "assistant", content: "", createdAt: 1, parts: [] };
}

function done(reason: "stop" | "cancelled" | "error" | "max_steps"): AgentStreamEvent {
  return { type: "done", sessionId: "s", reason };
}

describe("applyStreamToParts", () => {
  it("累积 text/reasoning 并在 reasoning_end 标记 done", () => {
    const parts: ChatMessage["parts"] = [];
    applyStreamToParts(parts!, { type: "reasoning_delta", sessionId: "s", text: "think" });
    applyStreamToParts(parts!, { type: "reasoning_end", sessionId: "s", durationMs: 12 });
    applyStreamToParts(parts!, { type: "delta", sessionId: "s", text: "answer" });
    expect(parts).toEqual([
      { type: "reasoning", text: "think", ms: 12, done: true },
      { type: "text", text: "answer", done: false },
    ]);
  });

  it("工具状态按生命周期展开，拒绝后不被成功覆盖", () => {
    const parts: ChatMessage["parts"] = [];
    applyStreamToParts(parts!, {
      type: "tool_input_start",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "readFile",
    });
    applyStreamToParts(parts!, {
      type: "tool_start",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "readFile",
      args: { path: "a.ts" },
    });
    applyStreamToParts(parts!, {
      type: "tool_end",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "readFile",
      ok: false,
      state: "denied",
      summary: "已拒绝执行",
    });
    applyStreamToParts(parts!, {
      type: "tool_end",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "readFile",
      ok: true,
      state: "ok",
      summary: "ok",
    });
    expect(parts?.[0]).toMatchObject({ state: "denied", summary: "已拒绝执行" });
  });

  it("tool_end 支持 cancelled 终态", () => {
    const parts: ChatMessage["parts"] = [];
    applyStreamToParts(parts!, {
      type: "tool_start",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "runTerminal",
      args: { command: "sleep 10" },
    });
    applyStreamToParts(parts!, {
      type: "tool_end",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "runTerminal",
      ok: false,
      state: "cancelled",
      summary: "已取消，未完成",
    });
    expect(parts?.[0]).toMatchObject({ state: "cancelled", summary: "已取消，未完成" });
  });
});

describe("applyStreamToMessage", () => {
  it("error 后 done(stop) 不覆盖 error 终态", () => {
    const message = emptyMessage();
    applyStreamToMessage(message, { type: "error", sessionId: "s", message: "boom" }, 10);
    applyStreamToMessage(message, done("stop"), 20);
    const run = getMessageRun(message);
    expect(run?.reason).toBe("error");
    expect(run?.error).toBe("boom");
    expect(run?.status).toBe("error");
  });

  it("done(cancelled) 把未完成工具标为 cancelled", () => {
    const message = emptyMessage();
    applyStreamToMessage(message, {
      type: "tool_start",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "bash",
      args: { cmd: "ls" },
    });
    applyStreamToMessage(message, done("cancelled"), 30);
    const part = message.parts?.[0];
    expect(part).toMatchObject({ type: "tool", state: "cancelled" });
    expect(getMessageRun(message)?.reason).toBe("cancelled");
  });

  it("done(stop/error) 把 running/awaiting-approval 标为 interrupted", () => {
    const message = emptyMessage();
    applyStreamToMessage(message, {
      type: "tool_start",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "bash",
      args: {},
    });
    message.parts?.push({ type: "tool", toolCallId: "t2", toolName: "writeFile", state: "awaiting-approval" });
    applyStreamToMessage(message, {
      type: "approval_request",
      sessionId: "s",
      request: { approvalId: "a1", toolCallId: "t2", toolName: "writeFile", input: {} },
    });
    applyStreamToMessage(message, done("stop"), 40);
    const states = (message.parts ?? []).filter((p) => p.type === "tool").map((p) => p.state);
    expect(states).toEqual(["interrupted", "interrupted"]);
  });

  it("审批通过不把工具标为 ok，拒绝标为 denied", () => {
    const message = emptyMessage();
    message.parts = [{ type: "tool", toolCallId: "t1", toolName: "bash", state: "awaiting-approval" }];
    applyStreamToMessage(message, {
      type: "approval_resolved",
      sessionId: "s",
      approvalId: "a1",
      toolCallId: "t1",
      approved: true,
    });
    expect(message.parts?.[0]).toMatchObject({ state: "running" });

    message.parts = [{ type: "tool", toolCallId: "t2", toolName: "bash", state: "awaiting-approval" }];
    applyStreamToMessage(message, {
      type: "approval_resolved",
      sessionId: "s",
      approvalId: "a2",
      toolCallId: "t2",
      approved: false,
    });
    expect(message.parts?.[0]).toMatchObject({ state: "denied" });
  });

  it("空正文仅含 run summary 也能被识别", () => {
    const message = emptyMessage();
    applyStreamToMessage(message, { type: "step_start", sessionId: "s", step: 2 }, 5);
    applyStreamToMessage(message, done("max_steps"), 9);
    const run = getMessageRun(message);
    expect(run?.reason).toBe("max_steps");
    expect(run?.step).toBe(2);
    expect(message.content).toBe("");
  });
});

describe("message meta round-trip", () => {
  it("encode/decode 保留 parts 与 meta.run", () => {
    const message: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "hello",
      createdAt: 1,
      parts: [
        { type: "text", text: "hello", done: true },
        {
          type: "tool",
          toolCallId: "t1",
          toolName: "readFile",
          state: "ok",
          args: { path: "a.ts" },
        },
      ],
      meta: { run: { reason: "stop", step: 1, usage: { inputTokens: 3, outputTokens: 4 } } },
    };
    const encoded = encodeChatMessageMeta(message);
    expect(encoded).toMatchObject({
      run: { reason: "stop", step: 1, usage: { inputTokens: 3, outputTokens: 4 } },
    });
    expect(Array.isArray((encoded as { parts?: unknown }).parts)).toBe(true);

    const decoded = decodeChatMessageMeta(JSON.stringify(encoded));
    expect(decoded.parts).toEqual(message.parts);
    expect(decoded.meta).toEqual(message.meta);
    expect(getMessageRun({ ...message, ...decoded })).toEqual(message.meta?.run);
  });

  it("无 parts 时 encode 只返回 meta", () => {
    const message: ChatMessage = {
      id: "m2",
      role: "assistant",
      content: "",
      createdAt: 2,
      meta: { run: { reason: "error", error: "boom" } },
    };
    expect(encodeChatMessageMeta(message)).toEqual(message.meta);
    const decoded = decodeChatMessageMeta(JSON.stringify(message.meta));
    expect(decoded.parts).toBeUndefined();
    expect(decoded.meta).toEqual(message.meta);
  });
});

describe("persist / restore helpers", () => {
  it("空正文但有 run summary 应落库", () => {
    const message = emptyMessage();
    applyStreamToMessage(message, done("cancelled"), 1);
    expect(shouldPersistAssistantMessage(message)).toBe(true);
  });

  it("完全空消息不落库", () => {
    expect(shouldPersistAssistantMessage(emptyMessage())).toBe(false);
  });

  it("restoreRunSummaryFromMessages 取最后一条 assistant", () => {
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "hi", createdAt: 1 },
      {
        id: "a1",
        role: "assistant",
        content: "old",
        createdAt: 2,
        meta: { run: { reason: "stop" } },
      },
      {
        id: "a2",
        role: "assistant",
        content: "",
        createdAt: 3,
        meta: { run: { reason: "error", error: "x", step: 4 } },
      },
    ];
    expect(restoreRunSummaryFromMessages(messages)).toEqual({ reason: "error", error: "x", step: 4 });
  });
});

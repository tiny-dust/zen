import { describe, expect, it } from "vitest";

import {
  applyStreamToMessage,
  applyStreamToParts,
  decodeChatMessageMeta,
  encodeChatMessageMeta,
  getMessageRun,
  restoreRunSummaryFromMessages,
  shouldPersistAssistantMessage,
} from "./agent-chat";

import type { ChatMessage, ChatMessagePart } from "./agent-chat";

/**
 * 消息流累积与持久化：
 * - applyStreamToParts 覆盖 delta / reasoning / 工具各状态与 tool_end 兜底
 * - applyStreamToMessage 覆盖 run summary 归并（status/step/usage/error/done）与工具终态补齐
 * - meta 编解码与落库判定
 */

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    createdAt: 1,
    ...overrides,
  };
}

describe("applyStreamToParts", () => {
  it("delta 顺序累积，reasoning_end 回填耗时", () => {
    const parts: ChatMessagePart[] = [];
    applyStreamToParts(parts, { type: "delta", sessionId: "s", text: "你" });
    applyStreamToParts(parts, { type: "delta", sessionId: "s", text: "好" });
    applyStreamToParts(parts, { type: "reasoning_delta", sessionId: "s", text: "想" });
    applyStreamToParts(parts, { type: "reasoning_delta", sessionId: "s", text: "想" });
    applyStreamToParts(parts, { type: "reasoning_end", sessionId: "s", durationMs: 12 });

    expect(parts).toEqual([
      { type: "text", text: "你好", done: false },
      { type: "reasoning", text: "想想", ms: 12, done: true },
    ]);
  });

  it("工具 input-streaming → running → progress → tool_end 合并到同一分段", () => {
    const parts: ChatMessagePart[] = [];
    applyStreamToParts(parts, {
      type: "tool_input_start",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "runTerminal",
    });
    applyStreamToParts(parts, {
      type: "tool_start",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "runTerminal",
      args: { command: "ls" },
    });
    applyStreamToParts(parts, {
      type: "tool_progress",
      sessionId: "s",
      event: { toolCallId: "t1", toolName: "runTerminal", message: "运行中", percent: 50 },
    });
    applyStreamToParts(parts, {
      type: "tool_end",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "runTerminal",
      ok: true,
      summary: "完成",
      output: "out",
    });

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "tool",
      toolCallId: "t1",
      state: "ok",
      summary: "完成",
      output: "out",
      args: { command: "ls" },
      percent: 50,
    });
  });

  it("tool_progress 不改写终态分段；denied 分段不被后续 tool_end 覆盖", () => {
    const parts: ChatMessagePart[] = [];
    applyStreamToParts(parts, {
      type: "tool_end",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "writeFile",
      ok: false,
      state: "denied",
      summary: "已拒绝执行",
    });
    applyStreamToParts(parts, {
      type: "tool_progress",
      sessionId: "s",
      event: { toolCallId: "t1", toolName: "writeFile", message: "运行中" },
    });
    applyStreamToParts(parts, {
      type: "tool_end",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "writeFile",
      ok: true,
      summary: "完成",
    });

    expect(parts[0]).toMatchObject({ state: "denied", error: "已拒绝执行" });
  });

  it("tool_end 没有前置分段时直接补一条", () => {
    const parts: ChatMessagePart[] = [];
    applyStreamToParts(parts, {
      type: "tool_end",
      sessionId: "s",
      toolCallId: "tx",
      toolName: "readFile",
      ok: false,
      summary: "失败",
    });
    expect(parts).toEqual([
      {
        type: "tool",
        toolCallId: "tx",
        toolName: "readFile",
        state: "error",
        summary: "失败",
        output: undefined,
        error: "失败",
      },
    ]);
  });
});

describe("meta 编解码与落库判定", () => {
  it("encode 把 parts 并入 meta，decode 提升回顶层", () => {
    const encoded = encodeChatMessageMeta({
      meta: { run: { status: "idle" } },
      parts: [{ type: "text", text: "hi" }],
    });
    expect(encoded).toEqual({
      run: { status: "idle" },
      parts: [{ type: "text", text: "hi" }],
    });

    const decoded = decodeChatMessageMeta(JSON.stringify(encoded));
    expect(decoded.parts).toEqual([{ type: "text", text: "hi" }]);
    expect(decoded.meta).toEqual({ run: { status: "idle" } });
  });

  it("encode 无 parts 时原样返回 meta；decode 空输入返回空对象", () => {
    expect(encodeChatMessageMeta({ meta: { a: 1 } })).toEqual({ a: 1 });
    expect(encodeChatMessageMeta({})).toBeUndefined();
    expect(decodeChatMessageMeta(null)).toEqual({});
    expect(decodeChatMessageMeta(undefined)).toEqual({});
    expect(decodeChatMessageMeta("{}")).toEqual({});
    expect(decodeChatMessageMeta(JSON.stringify({ parts: [] }))).toEqual({});
  });

  it("getMessageRun 只认 run 形状；shouldPersist 覆盖空正文但有 run 的情况", () => {
    expect(getMessageRun(message({ meta: { run: { reason: "stop" } } }))).toEqual({
      reason: "stop",
    });
    expect(getMessageRun(message({ meta: { run: "nope" } }))).toBeUndefined();
    expect(getMessageRun(message())).toBeUndefined();

    expect(shouldPersistAssistantMessage(message({ content: "x" }))).toBe(true);
    expect(shouldPersistAssistantMessage(message({ reasoning: "r" }))).toBe(true);
    expect(shouldPersistAssistantMessage(message({ parts: [{ type: "text", text: "t" }] }))).toBe(
      true,
    );
    expect(
      shouldPersistAssistantMessage(message({ meta: { run: { reason: "stop" } } })),
    ).toBe(true);
    expect(shouldPersistAssistantMessage(message())).toBe(false);
  });

  it("restoreRunSummaryFromMessages 取最后一条 assistant 的 run", () => {
    expect(
      restoreRunSummaryFromMessages([
        message({ id: "1", role: "assistant", meta: { run: { reason: "stop" } } }),
        message({ id: "2", role: "user", content: "q" }),
      ]),
    ).toEqual({ reason: "stop" });
    expect(
      restoreRunSummaryFromMessages([
        message({ id: "1", role: "assistant", meta: { run: { reason: "error" } } }),
        message({ id: "2", role: "assistant", meta: { run: { reason: "stop", step: 3 } } }),
      ]),
    ).toEqual({ reason: "stop", step: 3 });
    expect(
      restoreRunSummaryFromMessages([message({ id: "1", role: "assistant" })]),
    ).toBeNull();
    expect(restoreRunSummaryFromMessages([])).toBeNull();
  });
});

describe("applyStreamToMessage", () => {
  it("正文/思考累积到 content/reasoning，step/usage/状态写入 run", () => {
    const msg = message();
    applyStreamToMessage(msg, { type: "delta", sessionId: "s", text: "你好" }, 10);
    applyStreamToMessage(msg, { type: "reasoning_delta", sessionId: "s", text: "嗯" }, 11);
    applyStreamToMessage(msg, { type: "reasoning_end", sessionId: "s", durationMs: 9 }, 12);
    applyStreamToMessage(msg, { type: "step_start", sessionId: "s", step: 2 }, 13);
    applyStreamToMessage(msg, { type: "status", sessionId: "s", status: "thinking" }, 14);
    applyStreamToMessage(msg, { type: "usage", sessionId: "s", inputTokens: 3, outputTokens: 4 }, 15);

    expect(msg.content).toBe("你好");
    expect(msg.reasoning).toBe("嗯");
    expect(msg.reasoningMs).toBe(9);
    expect(msg.parts).toEqual([
      { type: "text", text: "你好", done: false },
      { type: "reasoning", text: "嗯", ms: 9, done: true },
    ]);
    expect(getMessageRun(msg)).toMatchObject({
      step: 2,
      status: "thinking",
      usage: { inputTokens: 3, outputTokens: 4 },
      startedAt: 13,
    });
  });

  it("审批请求/裁决更新工具分段状态", () => {
    const msg = message();
    applyStreamToMessage(msg, {
      type: "tool_start",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "writeFile",
      args: {},
    });
    applyStreamToMessage(msg, {
      type: "approval_request",
      sessionId: "s",
      request: { approvalId: "a1", toolCallId: "t1", toolName: "writeFile", input: {} },
    });
    expect(msg.parts?.[0]).toMatchObject({ state: "awaiting-approval", message: "等待审批" });
    expect(getMessageRun(msg)?.status).toBe("awaiting-approval");

    applyStreamToMessage(msg, {
      type: "approval_resolved",
      sessionId: "s",
      approvalId: "a1",
      toolCallId: "t1",
      approved: true,
    });
    expect(msg.parts?.[0]).toMatchObject({ state: "running", message: "已批准，等待执行" });

    applyStreamToMessage(msg, {
      type: "approval_request",
      sessionId: "s",
      request: { approvalId: "a2", toolCallId: "t1", toolName: "writeFile", input: {} },
    });
    applyStreamToMessage(msg, {
      type: "approval_resolved",
      sessionId: "s",
      approvalId: "a2",
      toolCallId: "t1",
      approved: false,
    });
    expect(msg.parts?.[0]).toMatchObject({
      state: "denied",
      summary: "已拒绝执行",
      error: "用户拒绝了这次工具调用",
    });
  });

  it("error 优先于 done；done/取消把未完成工具补终态", () => {
    const msg = message();
    applyStreamToMessage(msg, {
      type: "tool_start",
      sessionId: "s",
      toolCallId: "t1",
      toolName: "runTerminal",
      args: {},
    });
    applyStreamToMessage(msg, {
      type: "tool_start",
      sessionId: "s",
      toolCallId: "t2",
      toolName: "runTerminal",
      args: {},
    });
    applyStreamToMessage(msg, { type: "error", sessionId: "s", message: "炸了" }, 20);
    applyStreamToMessage(msg, { type: "done", sessionId: "s", reason: "stop" }, 21);

    expect(getMessageRun(msg)).toMatchObject({
      reason: "error",
      error: "炸了",
      status: "error",
      endedAt: 21,
    });
    expect(msg.parts?.[0]).toMatchObject({ state: "interrupted", message: "已中断" });
    expect(msg.parts?.[1]).toMatchObject({ state: "interrupted" });

    const cancelled = message();
    applyStreamToMessage(cancelled, {
      type: "tool_start",
      sessionId: "s",
      toolCallId: "t3",
      toolName: "runTerminal",
      args: {},
    });
    applyStreamToMessage(cancelled, { type: "done", sessionId: "s", reason: "cancelled" }, 30);
    expect(cancelled.parts?.[0]).toMatchObject({
      state: "cancelled",
      message: "已取消",
      error: "运行已取消，工具未完成",
    });
    expect(getMessageRun(cancelled)).toMatchObject({ reason: "cancelled", status: "idle" });
  });

  it("run 未变化时不重写 meta", () => {
    const msg = message();
    applyStreamToMessage(msg, { type: "step_start", sessionId: "s", step: 1 }, 5);
    const metaAfterFirst = msg.meta;
    applyStreamToMessage(msg, { type: "delta", sessionId: "s", text: "x" }, 6);
    expect(msg.meta).toBe(metaAfterFirst);
  });
});

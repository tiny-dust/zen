import { describe, expect, it } from "vitest";

import type { AgentStreamEvent, ChatMessage } from "@zen/shared";
import { BackgroundTranscripts, mergeBackgroundTranscript } from "@/stores/chat-background";

const SID = "session-a";

function delta(text: string): AgentStreamEvent {
  return { type: "delta", sessionId: SID, text };
}

function userMessage(text: string): ChatMessage {
  return {
    id: `user-${text}`,
    role: "user",
    content: text,
    createdAt: 1000,
  };
}

describe("BackgroundTranscripts", () => {
  it("stash 后连续 apply delta/tool_end/done 能重建带 parts 的助手消息", () => {
    const transcripts = new BackgroundTranscripts();
    transcripts.stash(SID, [userMessage("帮我查一下")]);

    transcripts.apply(SID, delta("正在"));
    transcripts.apply(SID, delta("查询"));
    transcripts.apply(SID, {
      type: "tool_start",
      sessionId: SID,
      toolCallId: "t1",
      toolName: "webSearch",
      args: { query: "zen" },
    });
    transcripts.apply(SID, {
      type: "tool_end",
      sessionId: SID,
      toolCallId: "t1",
      toolName: "webSearch",
      ok: true,
      summary: "已找到 3 条结果",
      output: [],
    });
    transcripts.apply(SID, {
      type: "usage",
      sessionId: SID,
      inputTokens: 100,
      outputTokens: 20,
    });
    transcripts.apply(SID, { type: "done", sessionId: SID, reason: "stop" });

    const restored = transcripts.take(SID);
    expect(restored).toHaveLength(2);
    const assistant = restored?.[1];
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.content).toBe("正在查询");
    const types = (assistant?.parts ?? []).map((part) => part.type);
    expect(types).toEqual(["text", "tool"]);
    const toolPart = assistant?.parts?.find((part) => part.type === "tool");
    expect(toolPart && toolPart.type === "tool" ? toolPart.state : undefined).toBe("ok");
    expect(toolPart && toolPart.type === "tool" ? toolPart.summary : undefined).toBe(
      "已找到 3 条结果",
    );
    expect(assistant?.meta?.run).toMatchObject({ reason: "stop", status: "idle" });
    expect(assistant?.meta?.run).toMatchObject({
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  });

  it("无助手消息时也建空助手气泡（直接调工具不输出正文）", () => {
    const transcripts = new BackgroundTranscripts();
    transcripts.stash(SID, [userMessage("跑个命令")]);
    transcripts.apply(SID, {
      type: "tool_start",
      sessionId: SID,
      toolCallId: "t1",
      toolName: "runTerminal",
      args: {},
    });
    const restored = transcripts.take(SID);
    expect(restored).toHaveLength(2);
    expect(restored?.[1]?.role).toBe("assistant");
    expect(restored?.[1]?.parts).toHaveLength(1);
  });

  it("insert_started / original_resumed 后续输出另起新气泡", () => {
    const transcripts = new BackgroundTranscripts();
    transcripts.stash(SID, [userMessage("长任务")]);

    transcripts.apply(SID, delta("第一段"));
    // 插入 run 开始：插入 run 的回复不能并进第一段气泡
    transcripts.apply(SID, { type: "insert_started", sessionId: SID, text: "补充" });
    transcripts.apply(SID, delta("插入回复"));
    // 插入 run 结束、原 run 恢复：续跑输出再另起一段
    transcripts.apply(SID, { type: "original_resumed", sessionId: SID });
    transcripts.apply(SID, delta("续跑回复"));

    const restored = transcripts.take(SID);
    const assistants = restored?.filter((message) => message.role === "assistant") ?? [];
    expect(assistants.map((message) => message.content)).toEqual([
      "第一段",
      "插入回复",
      "续跑回复",
    ]);
  });

  it("approval/ask/status 类事件不改消息", () => {
    const transcripts = new BackgroundTranscripts();
    transcripts.stash(SID, [userMessage("等等")]);
    const before = transcripts.take(SID) ?? [];
    expect(before).toHaveLength(1);

    transcripts.stash(SID, before);
    transcripts.apply(SID, {
      type: "approval_request",
      sessionId: SID,
      request: {
        approvalId: "a1",
        toolCallId: "t1",
        toolName: "writeFile",
        input: {},
      },
    });
    transcripts.apply(SID, { type: "status", sessionId: SID, status: "paused" });
    const after = transcripts.take(SID);
    expect(after).toEqual(before);
  });

  it("take 后清空，重复 take 返回 undefined", () => {
    const transcripts = new BackgroundTranscripts();
    transcripts.stash(SID, [userMessage("hi")]);
    expect(transcripts.has(SID)).toBe(true);
    expect(transcripts.take(SID)).toHaveLength(1);
    expect(transcripts.has(SID)).toBe(false);
    expect(transcripts.take(SID)).toBeUndefined();
    // drop 空缓冲也不抛错
    transcripts.drop(SID);
  });

  it("子 Agent 会话（::）不缓冲", () => {
    const transcripts = new BackgroundTranscripts();
    const childId = `${SID}::sub-1`;
    transcripts.stash(childId, [userMessage("child")]);
    transcripts.apply(childId, delta("子事件"));
    expect(transcripts.has(childId)).toBe(false);
    expect(transcripts.take(childId)).toBeUndefined();
  });

  it("从未 stash 的会话从首个事件懒建缓冲（计划任务等后台运行）", () => {
    const transcripts = new BackgroundTranscripts();
    transcripts.apply(SID, delta("第一句"));
    transcripts.apply(SID, delta("第二句"));
    expect(transcripts.has(SID)).toBe(true);
    const restored = transcripts.take(SID);
    // 缓冲只有流式增量；用户消息等已落库前缀由打开时的合并补上
    expect(restored).toHaveLength(1);
    expect(restored?.[0]?.role).toBe("assistant");
    expect(restored?.[0]?.content).toBe("第一句第二句");
  });

  it("切回仍在运行的会话：旧轮次落库 id 不同也只显示一次，新轮次流式内容保留", () => {
    const oldUser = userMessage("第一轮");
    const nextUser = userMessage("第二轮");
    const oldLocal: ChatMessage = {
      id: "old-local",
      role: "assistant",
      content: "已完成",
      createdAt: 1001,
    };
    const oldPersisted: ChatMessage = { ...oldLocal, id: "old-persisted", createdAt: 2001 };
    const transcripts = new BackgroundTranscripts();
    transcripts.stash(SID, [oldUser, oldLocal, nextUser]);
    transcripts.apply(SID, delta("正在处理第二轮"));

    const merged = mergeBackgroundTranscript(
      [oldUser, oldPersisted, nextUser],
      transcripts.take(SID) ?? [],
    );
    expect(merged.map((message) => message.id)).toEqual([
      oldUser.id,
      oldPersisted.id,
      nextUser.id,
      expect.any(String),
    ]);
    expect(merged.map((message) => message.content)).toEqual([
      "第一轮", "已完成", "第二轮", "正在处理第二轮",
    ]);
  });

  it("同文的不同轮次助手消息不能误去重", () => {
    const oldUser = userMessage("第一轮");
    const nextUser = userMessage("第二轮");
    const oldPersisted: ChatMessage = {
      id: "old-persisted",
      role: "assistant",
      content: "好的",
      createdAt: 2001,
    };
    const oldLocal = { ...oldPersisted, id: "old-local", createdAt: 1001 };
    const nextLocal = { ...oldLocal, id: "next-local", createdAt: 3001 };
    const merged = mergeBackgroundTranscript(
      [oldUser, oldPersisted, nextUser],
      [oldUser, oldLocal, nextUser, nextLocal],
    );
    expect(merged.map((message) => message.id)).toEqual([
      oldUser.id, oldPersisted.id, nextUser.id, nextLocal.id,
    ]);
  });

  it("mergeBackgroundTranscript：数据库前缀 + 缓冲增量按 id 去重", () => {
    const user = userMessage("跑一下");
    const partial: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "流式中",
      createdAt: 1001,
      parts: [],
    };
    // 切走快照：缓冲已含落库的用户消息，合并后不重复
    const snapshot = [user, partial];
    expect(mergeBackgroundTranscript([user], snapshot).map((m) => m.id)).toEqual([
      "user-跑一下",
      "a1",
    ]);
    // 从未打开过的懒建缓冲只含增量：直接衔接在数据库前缀后
    expect(mergeBackgroundTranscript([user], [partial]).map((m) => m.id)).toEqual([
      "user-跑一下",
      "a1",
    ]);
  });
});

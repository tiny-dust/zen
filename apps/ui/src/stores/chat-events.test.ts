import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { computed, ref } from "vue";

import type {
  AgentRunStatus,
  AskUserQuestionEvent,
  ChatMessage,
  ChatRunSummary,
} from "@zen/shared";

import { BackgroundTranscripts } from "@/stores/chat-background";
import { createChatEventGateway } from "@/stores/chat-events";
import type { ChatEventContext } from "@/stores/chat-events";
import type { PendingApproval, QueuedMessage, RunPhase } from "@/stores/chat-types";

function contextOf(): ChatEventContext {
  return {
    sessionId: ref("s1"),
    messages: ref<ChatMessage[]>([]),
    status: ref<AgentRunStatus>("idle"),
    phase: ref<RunPhase>("answering"),
    statusText: ref(""),
    lastError: ref(""),
    isRunning: computed(() => false),
    isPaused: ref(false),
    insertActive: ref(false),
    runSummary: ref<ChatRunSummary | null>(null),
    lastDoneReason: ref(null),
    currentStep: ref<number | null>(null),
    lastInputTokens: ref<number | null>(null),
    lastOutputTokens: ref<number | null>(null),
    pendingApproval: ref<PendingApproval | null>(null),
    pendingAsks: ref<AskUserQuestionEvent[]>([]),
    stashedAsks: new Map<string, AskUserQuestionEvent[]>(),
    pendingToolArgs: new Map<string, { toolName: string; args: unknown }>(),
    filesRevision: ref(0),
    usedUpdateTasks: ref(false),
    queuedMessages: ref<QueuedMessage[]>([]),
    backgroundTranscripts: new BackgroundTranscripts(),
    scheduleQueuedDispatch: () => {},
    refreshGit: () => {},
    onRunFinished: () => {},
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("createChatEventGateway context_overflow", () => {
  it("phase=retrying 只更新 statusText，不置 lastError、不改运行态", () => {
    const ctx = contextOf();
    const { handleStreamEvent } = createChatEventGateway(ctx);
    handleStreamEvent({
      type: "context_overflow",
      sessionId: "s1",
      phase: "retrying",
      droppedMessages: 4,
      detail: "trimmed 4 messages",
    });
    expect(ctx.statusText.value).toBe("上下文超出模型窗口，已自动裁剪早期对话并重试");
    expect(ctx.lastError.value).toBe("");
    expect(ctx.status.value).toBe("idle");
    expect(ctx.isPaused.value).toBe(false);
  });

  it("phase=failed 提示恢复失败，lastError 留给紧随的 error 事件", () => {
    const ctx = contextOf();
    const { handleStreamEvent } = createChatEventGateway(ctx);
    handleStreamEvent({
      type: "context_overflow",
      sessionId: "s1",
      phase: "failed",
      droppedMessages: 0,
      detail: "single oversized prompt",
    });
    expect(ctx.statusText.value).toBe("上下文超限自动恢复失败，请缩短会话或新建会话后重试");
    expect(ctx.lastError.value).toBe("");
  });
});

describe("createChatEventGateway context_compacted", () => {
  it("statusText 提示折叠条数，不置 lastError、不改运行态", () => {
    const ctx = contextOf();
    const { handleStreamEvent } = createChatEventGateway(ctx);
    handleStreamEvent({
      type: "context_compacted",
      sessionId: "s1",
      mode: "llm",
      droppedMessages: 6,
      summaryChars: 1200,
    });
    expect(ctx.statusText.value).toBe("上下文已自动压缩：6 条早期消息已折叠为结构化摘要");
    expect(ctx.lastError.value).toBe("");
    expect(ctx.status.value).toBe("idle");
    expect(ctx.isPaused.value).toBe(false);
  });
});

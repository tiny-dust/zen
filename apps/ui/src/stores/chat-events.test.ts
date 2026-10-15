import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { useAgentProcessesStore } from "@/stores/agent-processes";
import { useAgentsStore } from "@/stores/agents";
import { useSessionInfoStore } from "@/stores/session-info";

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
    lastCachedInputTokens: ref<number | null>(null),
    sessionTotalTokens: ref(0),
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

describe("createChatEventGateway 后台会话面板事件落桶", () => {
  function nodeOf(id: string) {
    return {
      id,
      sessionId: "s2",
      parentId: null,
      name: id,
      task: "任务",
      status: "running" as const,
      dependsOn: [],
      attempts: 1,
      maxAttempts: 1,
      log: [],
    };
  }

  it("后台会话的 agent_tree 落桶，不劫持当前视图；切回恢复", () => {
    const ctx = contextOf();
    const agents = useAgentsStore();
    agents.ensureSession("s1");
    const { handleStreamEvent } = createChatEventGateway(ctx);

    handleStreamEvent({
      type: "agent_tree",
      sessionId: "s2",
      agents: [nodeOf("a1")],
      concurrency: { limit: 2, running: 1 },
    });
    // 当前会话 s1 的 Agent 面板仍为空
    expect(agents.nodes).toHaveLength(0);
    // 切到 s2：后台落桶的树恢复
    agents.ensureSession("s2");
    expect(agents.nodes.map((item) => item.id)).toEqual(["a1"]);
  });

  it("后台会话的 runTerminal 进程事件落桶", () => {
    const ctx = contextOf();
    const processes = useAgentProcessesStore();
    processes.ensureSession("s1");
    const { handleStreamEvent } = createChatEventGateway(ctx);

    handleStreamEvent({
      type: "tool_start",
      sessionId: "s2",
      toolCallId: "tc1",
      toolName: "runTerminal",
      args: { command: "npm run dev" },
    });
    expect(processes.items).toHaveLength(0);
    processes.ensureSession("s2");
    expect(processes.items.map((item) => item.command)).toEqual(["npm run dev"]);
  });

  it("其它后台会话的子 Agent runTerminal 事件改挂到其父会话桶", () => {
    const ctx = contextOf();
    const processes = useAgentProcessesStore();
    processes.ensureSession("s1");
    const { handleStreamEvent } = createChatEventGateway(ctx);

    handleStreamEvent({
      type: "tool_start",
      sessionId: "s2::agent-1",
      toolCallId: "tc2",
      toolName: "runTerminal",
      args: { command: "vite" },
    });
    expect(processes.items).toHaveLength(0);
    processes.ensureSession("s2");
    expect(processes.items.map((item) => item.command)).toEqual(["vite"]);
  });

  it("后台会话的 tasks_updated / reference_found 落桶", () => {
    const ctx = contextOf();
    const info = useSessionInfoStore();
    info.ensureSession("s1");
    const { handleStreamEvent } = createChatEventGateway(ctx);

    handleStreamEvent({
      type: "tasks_updated",
      sessionId: "s2",
      version: 1,
      items: [{ id: "t1", label: "后台任务", done: false }],
    });
    handleStreamEvent({
      type: "reference_found",
      sessionId: "s2",
      reference: { id: "", title: "文档", url: "https://doc", source: "web" },
    });
    expect(info.versions).toHaveLength(0);
    expect(info.references).toHaveLength(0);
    info.ensureSession("s2");
    expect(info.activeTasks.map((item) => item.label)).toEqual(["后台任务"]);
    expect(info.references.map((item) => item.url)).toEqual(["https://doc"]);
  });
});

describe("createChatEventGateway delta 合批", () => {
  it("相邻同类 delta 合并为一次应用，phase 即时更新", async () => {
    vi.useFakeTimers();
    const ctx = contextOf();
    ctx.isRunning = computed(() => true);
    const { handleStreamEvent } = createChatEventGateway(ctx);
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "Hel" });
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "lo " });
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "world" });
    // phase 不等冲刷即时反映
    expect(ctx.phase.value).toBe("answering");
    // 尚未冲刷：消息还没建
    expect(ctx.messages.value.length).toBe(0);
    await vi.advanceTimersByTimeAsync(130);
    // 一次冲刷、一条助手消息、三段文本合并成同一 part 的完整内容
    const last = ctx.messages.value.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.content).toBe("Hello world");
    expect(last?.parts?.filter((p) => p.type === "text")).toHaveLength(1);
    vi.useRealTimers();
  });

  it("非 delta 事件先冲刷挂起内容，保持时间线顺序", async () => {
    vi.useFakeTimers();
    const ctx = contextOf();
    ctx.isRunning = computed(() => true);
    const { handleStreamEvent } = createChatEventGateway(ctx);
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "part1 " });
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "part2" });
    // 工具事件到达：先冲刷 delta 再应用工具
    handleStreamEvent({
      type: "tool_start",
      sessionId: "s1",
      toolCallId: "t1",
      toolName: "readFile",
      args: {},
    });
    const last = ctx.messages.value.at(-1);
    expect(last?.content).toBe("part1 part2");
    const toolPart = last?.parts?.find((p) => p.type === "tool");
    expect(toolPart?.type === "tool" && toolPart.toolCallId).toBe("t1");
    // 文本 part 在工具 part 之前（顺序保持）
    const types = last?.parts?.map((p) => p.type);
    expect(types?.indexOf("text")).toBeLessThan(types?.indexOf("tool") ?? Infinity);
    vi.useRealTimers();
  });

  it("reasoning 与 text 交错时不跨类型合并", async () => {
    vi.useFakeTimers();
    const ctx = contextOf();
    ctx.isRunning = computed(() => true);
    const { handleStreamEvent } = createChatEventGateway(ctx);
    handleStreamEvent({ type: "reasoning_delta", sessionId: "s1", text: "think " });
    handleStreamEvent({ type: "reasoning_delta", sessionId: "s1", text: "hard" });
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "answer" });
    await vi.advanceTimersByTimeAsync(130);
    const last = ctx.messages.value.at(-1);
    expect(last?.reasoning).toBe("think hard");
    expect(last?.content).toBe("answer");
    const types = last?.parts?.map((p) => p.type);
    expect(types).toEqual(["reasoning", "text"]);
    vi.useRealTimers();
  });

  it("切换会话后旧会话挂起的 delta 被丢弃，不写入新会话", async () => {
    vi.useFakeTimers();
    const ctx = contextOf();
    ctx.isRunning = computed(() => true);
    const { handleStreamEvent } = createChatEventGateway(ctx);
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "old " });
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "session" });
    // 用户切到 s2
    ctx.sessionId.value = "s2";
    await vi.advanceTimersByTimeAsync(130);
    expect(ctx.messages.value.length).toBe(0);
    // s2 的 delta 正常工作
    handleStreamEvent({ type: "delta", sessionId: "s2", text: "new" });
    await vi.advanceTimersByTimeAsync(130);
    expect(ctx.messages.value.at(-1)?.content).toBe("new");
    vi.useRealTimers();
  });

  it("done 前冲刷全部挂起 delta，终态内容完整", async () => {
    vi.useFakeTimers();
    const ctx = contextOf();
    ctx.isRunning = computed(() => true);
    const { handleStreamEvent } = createChatEventGateway(ctx);
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "final " });
    handleStreamEvent({ type: "delta", sessionId: "s1", text: "words" });
    handleStreamEvent({ type: "done", sessionId: "s1", reason: "stop" });
    const last = ctx.messages.value.at(-1);
    expect(last?.content).toBe("final words");
    vi.useRealTimers();
  });
});

import { uuid } from "rattail";
import type { ComputedRef, Ref } from "vue";

import type {
  AgentDoneReason,
  AgentRunStatus,
  AgentStreamEvent,
  AskUserQuestionEvent,
  ChatMessage,
  ChatRunSummary,
  TaskItem,
  ToolApprovalDecision,
} from "@zen/shared";
import { applyStreamToMessage, getMessageRun } from "@zen/shared";
import { toolDisplay } from "@/components/chat/tool-part";
import { playNotifySound } from "@/lib/notify-sound";
import { useAgentStore } from "@/stores/agent";
import { useAgentProcessesStore } from "@/stores/agent-processes";
import { useAgentsStore } from "@/stores/agents";
import { useBrowserStore } from "@/stores/browser";
import { pathFromToolArgs } from "@/stores/chat-types";
import type { PendingApproval, QueuedMessage, RunPhase } from "@/stores/chat-types";
import type { BackgroundTranscripts } from "@/stores/chat-background";
import { useGitStore } from "@/stores/git";
import { useSessionInfoStore } from "@/stores/session-info";
import { useSessionStatusStore } from "@/stores/session-status";
import { useSkillUsageStore } from "@/stores/skill-usage";
import { i18n } from "@/locales";

/**
 * 流事件处理的会话状态与回调：由 chat store 注入，事件网关只依赖这个窄接口。
 */
export interface ChatEventContext {
  sessionId: Ref<string>;
  messages: Ref<ChatMessage[]>;
  status: Ref<AgentRunStatus>;
  phase: Ref<RunPhase>;
  statusText: Ref<string>;
  lastError: Ref<string>;
  isRunning: ComputedRef<boolean>;
  isPaused: Ref<boolean>;
  /** 插入执行进行中：原 run 被打断（checkpoint 保留），插入 run 正在跑 */
  insertActive: Ref<boolean>;
  runSummary: Ref<ChatRunSummary | null>;
  lastDoneReason: Ref<AgentDoneReason | null>;
  currentStep: Ref<number | null>;
  lastInputTokens: Ref<number | null>;
  lastOutputTokens: Ref<number | null>;
  /** 最近一次请求的缓存命中输入 tokens（供应商不上报时为 null） */
  lastCachedInputTokens: Ref<number | null>;
  /** 本会话累计消耗 tokens（usage 事件累加，切会话归零） */
  sessionTotalTokens: Ref<number>;
  pendingApproval: Ref<PendingApproval | null>;
  /** askUser 挂起队列（多问询并发，按 askId 独立应答） */
  pendingAsks: Ref<AskUserQuestionEvent[]>;
  /** 非当前会话的挂起问询暂存：后台新到的 ask_user 记入，切回该会话时由 chat store 恢复 */
  stashedAsks: Map<string, AskUserQuestionEvent[]>;
  /** tool_start 入参暂存：tool_end 成功后据此把读写过的项目文件登记进参考 */
  pendingToolArgs: Map<string, { toolName: string; args: unknown }>;
  /** 工具写文件后递增，驱动右侧文件面板刷新 */
  filesRevision: Ref<number>;
  /** 本 run 是否调用过 updateTasks（done 时决定是否走 checklist 兜底） */
  usedUpdateTasks: Ref<boolean>;
  /** 运行中插入的排队消息 */
  queuedMessages: Ref<QueuedMessage[]>;
  /** 后台会话消息缓冲：切走的运行中会话，消息级事件持续归约进缓冲，切回时优先恢复 */
  backgroundTranscripts: BackgroundTranscripts;
  /** run 正常结束后调度队列续发队首 */
  scheduleQueuedDispatch: () => void;
  /** done 后刷新参考文件与 git 状态 */
  refreshGit: () => void;
  /** run 结束后触发自动会话标题（首次对话完成时升级占位标题） */
  onRunFinished: () => void;
}

function lastAssistantOf(messages: ChatMessage[]): ChatMessage | undefined {
  const last = messages.at(-1);
  return last?.role === "assistant" ? last : undefined;
}

/**
 * 运行证据事件：这些事件到达即证明对应会话有活跃 run。用于给「非本 UI 发起」
 * 的运行（计划任务后台执行、渲染层重载后仍在跑的 run）恢复运行态——
 * 本 UI 自己发起的 run 在 send() 时已置 thinking，不依赖这里。
 */
const RUN_EVIDENCE_EVENTS: ReadonlySet<AgentStreamEvent["type"]> = new Set([
  "delta",
  "reasoning_delta",
  "reasoning_end",
  "tool_input_start",
  "tool_start",
  "tool_progress",
  "tool_end",
  "step_start",
  "usage",
  "insert_started",
  "original_resumed",
  "agent_tree",
  "agent_status",
  "status",
  "approval_request",
  "ask_user",
]);

/**
 * 会话事件网关：流事件 → 本地消息归约与运行态流转，
 * 附带审批/askUser 的用户应答入口。
 */
export function createChatEventGateway(ctx: ChatEventContext) {
  const sessionStatusStore = useSessionStatusStore();
  /** 后台会话中处于插入 run 的 sessionId：其 done(phase=insert) 不能当会话结束 */
  const backgroundInserts = new Set<string>();

  /** 流式助手消息：无助手消息时先建一条空的（模型不输出正文直接调工具时也需要） */
  /** 原 run 恢复后另起新助手气泡：原 run 的续跑输出不并进插入 run 的回复气泡 */
  let breakAssistantBubble = false;

  function ensureAssistantMessage(): ChatMessage {
    let last = breakAssistantBubble ? undefined : lastAssistantOf(ctx.messages.value);
    breakAssistantBubble = false;
    if (!last) {
      const message: ChatMessage = {
        id: uuid(),
        role: "assistant",
        content: "",
        parts: [],
        createdAt: Date.now(),
      };
      ctx.messages.value.push(message);
      last = message;
    }
    last.parts ??= [];
    return last;
  }

  function applyToLiveAssistant(event: AgentStreamEvent): void {
    applyStreamToMessage(ensureAssistantMessage(), event);
  }

  function syncRunRefsFromMessage(message: ChatMessage): void {
    const summary = getMessageRun(message);
    if (!summary) {
      return;
    }
    ctx.runSummary.value = summary;
    if (summary.reason) ctx.lastDoneReason.value = summary.reason;
    if (summary.step != null) ctx.currentStep.value = summary.step;
    if (summary.usage) {
      if (summary.usage.inputTokens > 0) {
        ctx.lastInputTokens.value = summary.usage.inputTokens;
      }
      if (summary.usage.outputTokens > 0) {
        ctx.lastOutputTokens.value = summary.usage.outputTokens;
      }
    }
    if (summary.error) ctx.lastError.value = summary.error;
  }

  /**
   * 兜底：模型没调 updateTasks、却在正文里写了 markdown 任务清单时，
   * 从最后一条助手消息提取 `- [ ]` / `- [x]` 列表，灌入会话信息卡。
   */
  function applyChecklistFallback(): void {
    const last = lastAssistantOf(ctx.messages.value);
    if (!last?.content) {
      return;
    }
    const items: TaskItem[] = [];
    for (const line of last.content.split("\n")) {
      const match = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
      if (match) {
        items.push({
          id: `auto-${items.length + 1}`,
          label: (match[2] ?? "").trim(),
          done: (match[1] ?? " ") !== " ",
        });
      }
    }
    if (items.length < 2) {
      return;
    }
    const version = (useSessionInfoStore().versions.at(-1)?.version ?? 0) + 1;
    useSessionInfoStore().applyTasksUpdated(ctx.sessionId.value, version, items);
  }

  /** 审批/提问等待结束后，若无其它挂起则恢复 running 态 */
  function resumeStatusIfIdle(): void {
    if (ctx.isRunning.value && !ctx.pendingApproval.value && !ctx.pendingAsks.value.length) {
      sessionStatusStore.set(ctx.sessionId.value, "running");
    }
  }

  /**
   * 非当前会话的后台事件：面板数据（Agent 树 / 进程 / 任务清单 / 参考）按会话
   * 写进对应 store 的桶（store 内按 activeKey 分流，不会劫持当前视图），
   * 运行态由 sessionStatusStore 维护并播提示音。子 Agent 会话（sessionId 带 ::）
   * 不上侧栏；其 runTerminal 进程事件改挂到父会话的桶。
   */
  function handleBackgroundEvent(event: AgentStreamEvent): void {
    const id = event.sessionId;
    // 当前会话的子 Agent（sessionId 形如 `父::agentId`）：只把 runTerminal 进程
    // 事件改挂到父会话喂「进程」面板，其余子事件不上任何面板
    if (id.startsWith(`${ctx.sessionId.value}::`)) {
      if (
        event.type === "tool_start" ||
        event.type === "tool_progress" ||
        event.type === "tool_end"
      ) {
        useAgentProcessesStore().handleStreamEvent({
          ...event,
          sessionId: ctx.sessionId.value,
        } as AgentStreamEvent);
      }
      return;
    }
    if (id.includes("::")) {
      // 其它后台会话的子 Agent：runTerminal 进程事件同样改挂到其父会话的桶
      if (
        event.type === "tool_start" ||
        event.type === "tool_progress" ||
        event.type === "tool_end"
      ) {
        const parentId = id.split("::")[0] ?? "";
        useAgentProcessesStore().handleStreamEvent({
          ...event,
          sessionId: parentId,
        } as AgentStreamEvent);
      }
      return;
    }
    // 运行证据且该会话尚无运行态：置 running（侧栏「进行中」）。
    // 计划任务等从未在前台打开过的会话由此获得运行态：中途打开时才能判为
    // 「运行中恢复」（bgResumable）并采用后台缓冲补看已流出的内容
    if (sessionStatusStore.get(id) === "idle" && RUN_EVIDENCE_EVENTS.has(event.type)) {
      sessionStatusStore.set(id, "running");
    }
    // 后台会话的面板事件落桶：store 按 activeKey 分流写进该会话的桶（不劫持当前视图）
    if (event.type === "agent_tree" || event.type === "agent_status") {
      useAgentsStore().handleStreamEvent(event);
    }
    useAgentProcessesStore().handleStreamEvent(event);
    if (event.type === "tasks_updated") {
      useSessionInfoStore().applyTasksUpdated(
        event.sessionId,
        event.version,
        event.items,
        event.agentName,
      );
    } else if (event.type === "reference_found") {
      useSessionInfoStore().addReference(event.sessionId, event.reference);
    }
    // 消息级事件持续归约进后台缓冲（无缓冲的会话 apply 内部忽略），
    // 切回运行中会话时优先用缓冲恢复，运行中未落库的流式内容不丢
    ctx.backgroundTranscripts.apply(id, event);
    switch (event.type) {
      case "insert_started":
        // 后台会话进入插入 run：其 done（phase=insert）不能当会话结束
        backgroundInserts.add(id);
        break;
      case "original_resumed":
        backgroundInserts.delete(id);
        break;
      case "approval_request":
      case "ask_user":
        if (event.type === "ask_user") {
          // 后台会话的问询记入暂存：切回该会话时恢复出问询卡（主进程仍在等应答）
          const question = event.question;
          const stashed = ctx.stashedAsks.get(id) ?? [];
          if (!stashed.some((item) => item.askId === question.askId)) {
            ctx.stashedAsks.set(id, [...stashed, question]);
          }
        }
        sessionStatusStore.set(id, "needs_action");
        playNotifySound("needsAction");
        break;
      case "approval_resolved":
      case "ask_resolved":
        if (event.type === "ask_resolved") {
          ctx.stashedAsks.set(
            id,
            (ctx.stashedAsks.get(id) ?? []).filter((item) => item.askId !== event.askId),
          );
        }
        sessionStatusStore.set(id, "running");
        break;
      case "done": {
        // 插入 run 的终态不是会话结束：保持 running，等 original_resumed
        if (backgroundInserts.has(id) && event.phase === "insert") {
          break;
        }
        backgroundInserts.delete(id);
        // 会话已结束：挂起问询不再有效（主进程侧已随 run 终止）
        ctx.stashedAsks.delete(id);
        // run 终态内容在 done 广播前已落库（main 侧先 persist 再 send）：
        // 丢弃后台缓冲防泄漏，之后再打开走数据库恢复
        ctx.backgroundTranscripts.drop(id);
        const isError = event.reason === "error";
        sessionStatusStore.set(id, isError ? "error" : "done");
        playNotifySound(isError ? "error" : "done");
        break;
      }
      default:
        break;
    }
  }

  /**
   * delta 合批：流式 token 逐个到达，逐个应用会让整条消息 markdown 全量重解析、
   * 代码块全量重高亮（成本随消息长度线性放大，长回复直接烧满一核 CPU）。
   * 相邻同类 delta 合并成一个事件，120ms 窗口冲刷；任何非 delta 事件到达先
   * 冲刷，保证与工具调用 / 终态事件的先后顺序不变。
   */
  const DELTA_FLUSH_MS = 120;
  let deltaQueue: Array<{ type: "delta" | "reasoning_delta"; text: string }> = [];
  let deltaOwner = "";
  let deltaTimer: ReturnType<typeof setTimeout> | undefined;

  function flushDeltas(): void {
    if (deltaTimer !== undefined) {
      clearTimeout(deltaTimer);
      deltaTimer = undefined;
    }
    if (!deltaQueue.length) {
      return;
    }
    const queue = deltaQueue;
    deltaQueue = [];
    // 会话已切换：挂起 delta 属于旧会话，直接丢弃（切走的会话由后台缓冲接管）
    if (deltaOwner !== ctx.sessionId.value) {
      return;
    }
    for (const item of queue) {
      applyToLiveAssistant(
        item.type === "delta"
          ? { type: "delta", sessionId: deltaOwner, text: item.text }
          : { type: "reasoning_delta", sessionId: deltaOwner, text: item.text },
      );
    }
  }

  function handleStreamEvent(event: AgentStreamEvent): void {
    if (event.sessionId !== ctx.sessionId.value) {
      handleBackgroundEvent(event);
      return;
    }

    // 本会话收到运行证据但本地无运行态：run 不是本 UI 发起（计划任务后台启动后
    // 立即打开、渲染层重载后 run 仍在跑）——恢复运行态：输入禁用、停止按钮可用
    if (ctx.status.value === "idle" && RUN_EVIDENCE_EVENTS.has(event.type)) {
      ctx.status.value = "thinking";
      ctx.phase.value = "thinking";
      ctx.isPaused.value = false;
      sessionStatusStore.set(ctx.sessionId.value, "running");
    }

    // 子 Agent 树 / runTerminal 进程：悬浮信息卡数据源
    if (event.type === "agent_tree" || event.type === "agent_status") {
      useAgentsStore().handleStreamEvent(event);
    }
    useAgentProcessesStore().handleStreamEvent(event);

    // delta 高频：进合批缓冲（见 flushDeltas），phase 即时更新不等待冲刷
    if (event.type === "delta" || event.type === "reasoning_delta") {
      if (deltaOwner !== event.sessionId) {
        flushDeltas();
        deltaOwner = event.sessionId;
      }
      const tail = deltaQueue[deltaQueue.length - 1];
      if (tail && tail.type === event.type) {
        tail.text += event.text;
      } else {
        deltaQueue.push({ type: event.type, text: event.text });
      }
      if (deltaTimer === undefined) {
        deltaTimer = setTimeout(flushDeltas, DELTA_FLUSH_MS);
      }
      ctx.phase.value = event.type === "delta" ? "answering" : "thinking";
      return;
    }

    // 其余事件先冲刷挂起的 delta，保持时间线顺序
    flushDeltas();

    // 与 main 共用消息级 reducer：parts / content / run summary / 未完成工具终态
    if (
      event.type === "reasoning_end" ||
      event.type === "tool_input_start" ||
      event.type === "tool_start" ||
      event.type === "tool_progress" ||
      event.type === "tool_end" ||
      event.type === "approval_request" ||
      event.type === "approval_resolved" ||
      event.type === "step_start" ||
      event.type === "usage" ||
      event.type === "error" ||
      event.type === "done"
    ) {
      applyToLiveAssistant(event);
    }

    switch (event.type) {
      case "reasoning_end":
        break;
      case "tool_input_start":
        break;
      case "tool_start":
        ctx.pendingToolArgs.set(event.toolCallId, { toolName: event.toolName, args: event.args });
        // Agent 需要用浏览器时：自动打开右栏浏览器面板并导航
        if (typeof event.toolName === "string" && event.toolName.startsWith("browser")) {
          useBrowserStore().onAgentBrowserTool(event.toolName, event.args);
        }
        // 技能/MCP 调用感知：输入框上方弹出 tag
        useSkillUsageStore().noteToolStart(event.sessionId, event.toolName, event.args);
        break;
      case "tool_end": {
        // 读写文件成功 → 收进悬浮面板「参考 · 项目」（按路径去重）
        const pending = ctx.pendingToolArgs.get(event.toolCallId);
        ctx.pendingToolArgs.delete(event.toolCallId);
        const touchedPath = pending ? pathFromToolArgs(pending.toolName, pending.args) : "";
        if (touchedPath && event.ok) {
          useSessionInfoStore().addReference(event.sessionId, {
            id: "",
            title: touchedPath.split("/").pop() || touchedPath,
            url: touchedPath,
            source: "project",
          });
        }
        if (event.toolName === "writeFile" || event.toolName === "editFile") {
          ctx.filesRevision.value += 1;
        }
        useSkillUsageStore().noteToolEnd(
          event.sessionId,
          event.toolName,
          event.ok,
          pending?.args,
        );
        ctx.statusText.value = event.summary;
        break;
      }
      case "agent_tree":
      case "agent_status":
        break;
      case "approval_request":
        ctx.pendingApproval.value = {
          approvalId: event.request.approvalId,
          toolCallId: event.request.toolCallId,
          toolName: event.request.toolName,
          prompt:
            event.request.reason ??
            i18n.global.t("app.chat.approvalNeeded", {
              label: toolDisplay(event.request.toolName, event.request.input).label,
            }),
          input: event.request.input,
        };
        ctx.statusText.value = i18n.global.t("app.chat.waitingApproval");
        sessionStatusStore.set(ctx.sessionId.value, "needs_action");
        playNotifySound("needsAction");
        break;
      case "approval_resolved":
        if (ctx.pendingApproval.value?.approvalId === event.approvalId) {
          ctx.pendingApproval.value = null;
        }
        ctx.statusText.value = event.approved
          ? i18n.global.t("app.chat.approvedWaiting")
          : i18n.global.t("app.chat.rejected");
        resumeStatusIfIdle();
        break;
      case "ask_user": {
        // 多问询：按 askId 入队，禁止覆盖丢卡；子 Agent 提问带 agentName
        const question = event.question;
        if (!ctx.pendingAsks.value.some((item) => item.askId === question.askId)) {
          ctx.pendingAsks.value = [...ctx.pendingAsks.value, question];
        }
        ctx.statusText.value = question.agentName
          ? i18n.global.t("app.chat.waitingAnswerWithAgent", { name: question.agentName })
          : i18n.global.t("app.chat.waitingAnswer");
        sessionStatusStore.set(ctx.sessionId.value, "needs_action");
        playNotifySound("needsAction");
        break;
      }
      case "ask_resolved": {
        ctx.pendingAsks.value = ctx.pendingAsks.value.filter((item) => item.askId !== event.askId);
        resumeStatusIfIdle();
        break;
      }
      case "status":
        ctx.status.value = event.status;
        if (event.status === "paused") {
          ctx.isPaused.value = true;
          ctx.statusText.value = i18n.global.t("app.chat.paused");
        } else if (event.status === "awaiting-approval") {
          ctx.isPaused.value = false;
          ctx.statusText.value = i18n.global.t("app.chat.waitingApproval");
        } else {
          ctx.isPaused.value = false;
        }
        break;
      case "error":
        ctx.lastError.value = event.message;
        ctx.statusText.value = event.message;
        syncRunRefsFromMessage(ensureAssistantMessage());
        break;
      case "context_overflow":
        // 上下文超限自动恢复只是提示而非错误：lastError 留给紧随的 error 事件
        ctx.statusText.value =
          event.phase === "retrying"
            ? i18n.global.t("app.chat.contextOverflowRetrying")
            : i18n.global.t("app.chat.contextOverflowFailed");
        break;
      case "context_compacted":
        // 步间主动压缩只是过程提示而非错误：不置 lastError、不改运行态
        ctx.statusText.value = i18n.global.t("app.chat.contextCompacted", {
          count: event.droppedMessages,
        });
        break;
      case "step_start":
        ctx.currentStep.value = event.step;
        break;
      case "usage": {
        // 个别供应商只报输出 token：输入为 0/null 时保留旧值，避免上下文统计被抹成 0%
        // 兼容 camelCase / snake_case 字段名（协议层与 AI SDK 命名不一致时）
        const raw = event as unknown as {
          inputTokens?: number | null;
          outputTokens?: number | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
        };
        const inputTokens = raw.inputTokens ?? raw.input_tokens ?? raw.prompt_tokens ?? null;
        const outputTokens = raw.outputTokens ?? raw.output_tokens ?? raw.completion_tokens ?? null;
        if (inputTokens != null && inputTokens > 0) {
          ctx.lastInputTokens.value = inputTokens;
        }
        if (outputTokens != null && outputTokens > 0) {
          ctx.lastOutputTokens.value = outputTokens;
        }
        // 会话累计消耗：每次上报的 input+output 都计入（含工具循环的每步请求）
        ctx.sessionTotalTokens.value += Math.max(0, inputTokens ?? 0) + Math.max(0, outputTokens ?? 0);
        // 缓存命中：协议新字段（cachedInputTokens）；未上报时清空，不残留上一请求的值
        ctx.lastCachedInputTokens.value =
          "cachedInputTokens" in event ? (event.cachedInputTokens ?? null) : null;
        break;
      }
      case "insert_started":
        // 插入 run 开始：原 run 已暂停，后续流事件属于插入 run。
        // insertQueued 已乐观置位 insertActive；这里同步状态与提示文案
        ctx.insertActive.value = true;
        ctx.isPaused.value = false;
        ctx.status.value = "thinking";
        ctx.phase.value = "thinking";
        ctx.statusText.value = i18n.global.t("app.chat.insertRunning");
        break;
      case "original_resumed":
        // 插入 run 完成，原 run 从 checkpoint 恢复：回到正常 running 语义。
        // 之后的流式输出要另起新助手气泡，不并进插入 run 的回复
        ctx.insertActive.value = false;
        breakAssistantBubble = true;
        ctx.isPaused.value = false;
        ctx.status.value = "thinking";
        ctx.statusText.value = i18n.global.t("app.chat.originalResumed");
        break;
      case "done": {
        // 插入 run 的终态：不是会话结束——不置 idle、不播音、不触发队列续发，
        // 等 original_resumed 后原 run 继续跑，其 done 才走完整收尾
        if (event.phase === "insert") {
          ctx.isPaused.value = false;
          ctx.pendingApproval.value = null;
          ctx.statusText.value = i18n.global.t("app.chat.insertDone");
          break;
        }
        const message = ensureAssistantMessage();
        syncRunRefsFromMessage(message);
        const reason = ctx.runSummary.value?.reason ?? event.reason;
        ctx.lastDoneReason.value = reason;
        ctx.status.value = reason === "error" ? "error" : "idle";
        ctx.isPaused.value = false;
        ctx.pendingApproval.value = null;
        ctx.pendingAsks.value = [];
        ctx.statusText.value =
          reason === "cancelled"
            ? i18n.global.t("app.chat.cancelled")
            : reason === "max_steps"
              ? i18n.global.t("app.chat.stepLimitReached")
              : reason === "error"
                ? (ctx.lastError.value || i18n.global.t("app.chat.runFailed"))
                : i18n.global.t("app.chat.completed");
        sessionStatusStore.set(ctx.sessionId.value, reason === "error" ? "error" : "done");
        playNotifySound(reason === "error" ? "error" : "done");
        if (!ctx.usedUpdateTasks.value && reason === "stop") {
          applyChecklistFallback();
        }
        ctx.onRunFinished();
        ctx.usedUpdateTasks.value = false;
        ctx.pendingToolArgs.clear();
        // run 终态：落定所有「进行中」的技能/MCP tag
        useSkillUsageStore().endRun(event.sessionId);
        ctx.refreshGit();
        void useGitStore().refreshStatus();
        // 正常收尾且还有插入消息 → 稍候自动续发队首（取消/出错时保留队列待用户处理）
        if (ctx.queuedMessages.value.length && (reason === "stop" || reason === "max_steps")) {
          ctx.scheduleQueuedDispatch();
        }
        break;
      }
      case "tasks_updated": {
        // 任务清单只更新会话信息卡（悬浮面板）；不再往时间线插快照卡片。
        // 带 agentName 的是子 Agent 侧信道事件，store 内按 upsert 合并而非整表替换
        ctx.usedUpdateTasks.value = true;
        useSessionInfoStore().applyTasksUpdated(
          event.sessionId,
          event.version,
          event.items,
          event.agentName,
        );
        break;
      }
      case "reference_found":
        useSessionInfoStore().addReference(event.sessionId, event.reference);
        break;
    }
  }

  /** 审批当前挂起的工具调用（拒绝 = approve(false)） */
  async function approve(approved: boolean, always = false): Promise<void> {
    const zen = window.zen;
    const approval = ctx.pendingApproval.value;
    if (!zen || !approval) {
      return;
    }
    const decision: ToolApprovalDecision = {
      approvalId: approval.approvalId,
      approved,
      ...(always ? { always } : {}),
    };
    await zen.agent.resolveApproval(ctx.sessionId.value, decision);
  }

  /** 回答指定 askUser 提问（多问询按 askId 独立应答） */
  async function submitAsk(askId: string, answer: string): Promise<void> {
    const zen = window.zen;
    const trimmed = answer.trim();
    if (!zen || !askId || !trimmed) {
      return;
    }
    ctx.pendingAsks.value = ctx.pendingAsks.value.filter((item) => item.askId !== askId);
    await zen.agent.resolveAsk(ctx.sessionId.value, { askId, answer: trimmed });
  }

  function dismissApproval(): void {
    ctx.pendingApproval.value = null;
    ctx.statusText.value = i18n.global.t("app.chat.approvalDismissed");
  }

  return { handleStreamEvent, approve, submitAsk, dismissApproval };
}

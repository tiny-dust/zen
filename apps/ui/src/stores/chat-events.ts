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
import { useGitStore } from "@/stores/git";
import { useSessionInfoStore } from "@/stores/session-info";
import { useSessionStatusStore } from "@/stores/session-status";
import { useSkillUsageStore } from "@/stores/skill-usage";

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
  runSummary: Ref<ChatRunSummary | null>;
  lastDoneReason: Ref<AgentDoneReason | null>;
  currentStep: Ref<number | null>;
  lastInputTokens: Ref<number | null>;
  lastOutputTokens: Ref<number | null>;
  pendingApproval: Ref<PendingApproval | null>;
  /** askUser 挂起队列（多问询并发，按 askId 独立应答） */
  pendingAsks: Ref<AskUserQuestionEvent[]>;
  /** tool_start 入参暂存：tool_end 成功后据此把读写过的项目文件登记进参考 */
  pendingToolArgs: Map<string, { toolName: string; args: unknown }>;
  /** 工具写文件后递增，驱动右侧文件面板刷新 */
  filesRevision: Ref<number>;
  /** 本 run 是否调用过 updateTasks（done 时决定是否走 checklist 兜底） */
  usedUpdateTasks: Ref<boolean>;
  /** 运行中插入的排队消息 */
  queuedMessages: Ref<QueuedMessage[]>;
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
 * 会话事件网关：流事件 → 本地消息归约与运行态流转，
 * 附带审批/askUser 的用户应答入口。
 */
export function createChatEventGateway(ctx: ChatEventContext) {
  const sessionStatusStore = useSessionStatusStore();

  /** 流式助手消息：无助手消息时先建一条空的（模型不输出正文直接调工具时也需要） */
  function ensureAssistantMessage(): ChatMessage {
    let last = lastAssistantOf(ctx.messages.value);
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

  function handleStreamEvent(event: AgentStreamEvent): void {
    if (event.sessionId !== ctx.sessionId.value) {
      return;
    }

    // 子 Agent 树 / runTerminal 进程：悬浮信息卡数据源
    if (event.type === "agent_tree" || event.type === "agent_status") {
      useAgentsStore().handleStreamEvent(event);
    }
    useAgentProcessesStore().handleStreamEvent(event);

    // 与 main 共用消息级 reducer：parts / content / run summary / 未完成工具终态
    if (
      event.type === "delta" ||
      event.type === "reasoning_delta" ||
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
      case "delta":
        ctx.phase.value = "answering";
        break;
      case "reasoning_delta":
        ctx.phase.value = "thinking";
        break;
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
            `需要审批工具调用：${toolDisplay(event.request.toolName, event.request.input).label}`,
          input: event.request.input,
        };
        ctx.statusText.value = "等待工具审批";
        sessionStatusStore.set(ctx.sessionId.value, "needs_action");
        playNotifySound("needsAction");
        break;
      case "approval_resolved":
        if (ctx.pendingApproval.value?.approvalId === event.approvalId) {
          ctx.pendingApproval.value = null;
        }
        ctx.statusText.value = event.approved ? "已批准，等待执行" : "已拒绝";
        resumeStatusIfIdle();
        break;
      case "ask_user": {
        // 多问询：按 askId 入队，禁止覆盖丢卡；子 Agent 提问带 agentName
        const question = event.question;
        if (!ctx.pendingAsks.value.some((item) => item.askId === question.askId)) {
          ctx.pendingAsks.value = [...ctx.pendingAsks.value, question];
        }
        ctx.statusText.value = question.agentName
          ? `${question.agentName} 等待你的回答`
          : "等待你的回答";
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
          ctx.statusText.value = "已暂停";
        } else if (event.status === "awaiting-approval") {
          ctx.isPaused.value = false;
          ctx.statusText.value = "等待工具审批";
        } else {
          ctx.isPaused.value = false;
        }
        break;
      case "error":
        ctx.lastError.value = event.message;
        ctx.statusText.value = event.message;
        syncRunRefsFromMessage(ensureAssistantMessage());
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
        break;
      }
      case "done": {
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
            ? "已取消"
            : reason === "max_steps"
              ? "已达到步骤上限"
              : reason === "error"
                ? (ctx.lastError.value || "运行失败")
                : "已完成";
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
        // 任务清单只更新会话信息卡（悬浮面板）；不再往时间线插快照卡片
        ctx.usedUpdateTasks.value = true;
        useSessionInfoStore().applyTasksUpdated(event.sessionId, event.version, event.items);
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
    ctx.statusText.value = "审批提示已收起";
  }

  return { handleStreamEvent, approve, submitAsk, dismissApproval };
}

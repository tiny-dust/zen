import { defineStore } from "pinia";
import { uuid } from "rattail";
import { computed, ref, watch } from "vue";

import type {
  AgentRunStatus,
  AgentStreamEvent,
  AttachmentRef,
  ChatMessage,
  ChatTurn,
  ReasoningEffort,
  SessionRecord,
  ToolApprovalDecision,
  ToolCallState,
} from "@zen/shared";
import { useModelsStore } from "@/stores/models";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AppInfo } from "@/types/zen-api";

type RunPhase = "thinking" | "answering";

export interface ActiveTool {
  toolCallId: string;
  toolName: string;
  message: string;
  state: ToolCallState;
  percent?: number;
}

export interface ToolHistoryItem {
  id: string;
  toolName: string;
  summary: string;
  ok: boolean;
  output?: unknown;
}

export interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  prompt: string;
  input?: unknown;
}

export interface ComposerAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  isImage: boolean;
}

export const useChatStore = defineStore("chat", () => {
  const messages = ref<ChatMessage[]>([]);
  const input = ref("");
  const status = ref<AgentRunStatus>("idle");
  const phase = ref<RunPhase>("answering");
  const statusText = ref("");
  const lastError = ref("");
  const sessionId = ref(uuid());
  const sessionName = ref("新会话");
  /** 当前会话归属的工作区（'common' = 公共区），决定 agent 工作目录与 git 信息来源 */
  const sessionWorkspaceId = ref<string>("common");
  const appInfo = ref<AppInfo | null>(null);
  const effort = ref<ReasoningEffort>("off");
  const attachments = ref<ComposerAttachment[]>([]);
  const activeTool = ref<ActiveTool | null>(null);
  const toolHistory = ref<ToolHistoryItem[]>([]);
  const pendingApproval = ref<PendingApproval | null>(null);
  const isPaused = ref(false);
  const branch = ref("");
  const repo = ref("");
  const lastInputTokens = ref<number | null>(null);

  /** 输入草稿防抖落库，切换会话回来可恢复 */
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  watch(input, (value) => {
    const zen = window.zen;
    if (!zen || !sessionId.value) {
      return;
    }
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      void zen.session.setDraft(sessionId.value, value);
    }, 400);
  });

  function flushDraft() {
    const zen = window.zen;
    clearTimeout(draftTimer);
    if (zen && sessionId.value) {
      void zen.session.setDraft(sessionId.value, input.value);
    }
  }

  const isRunning = computed(() =>
    ["thinking", "answering", "tool-running", "awaiting-approval"].includes(status.value),
  );
  const hasMessages = computed(() => messages.value.length > 0);
  const canSend = computed(
    () => (input.value.trim().length > 0 || attachments.value.length > 0) && !isRunning.value,
  );
  const workspaceRoot = computed(() => appInfo.value?.workspaceRoot ?? "");

  /** 上下文用量：最近一次请求的输入 token / 模型上下文窗口（%） */
  const contextUsage = computed(() => {
    const contextWindow = useModelsStore().selectedModel?.capabilities?.contextWindow ?? 0;
    if (!contextWindow || lastInputTokens.value == null) {
      return null;
    }
    return Math.min(100, Math.round((lastInputTokens.value / contextWindow) * 100));
  });

  async function refreshGit() {
    const zen = window.zen;
    if (!zen?.git) {
      return;
    }
    const cwd = useWorkspaceStore().pathOf(sessionWorkspaceId.value);
    const info = await zen.git.info(cwd);
    repo.value = info.repo;
    branch.value = info.branch;
  }

  function appendMessage(message: ChatMessage) {
    messages.value.push(message);
  }

  function lastAssistant(): ChatMessage | undefined {
    const last = messages.value.at(-1);
    return last?.role === "assistant" ? last : undefined;
  }

  function appendDelta(text: string) {
    phase.value = "answering";
    const last = lastAssistant();
    if (last) {
      last.content += text;
      return;
    }
    appendMessage({
      id: uuid(),
      role: "assistant",
      content: text,
      createdAt: Date.now(),
    });
  }

  function appendReasoning(text: string) {
    phase.value = "thinking";
    const last = lastAssistant();
    if (last) {
      last.reasoning = (last.reasoning ?? "") + text;
      return;
    }
    appendMessage({
      id: uuid(),
      role: "assistant",
      content: "",
      reasoning: text,
      createdAt: Date.now(),
    });
  }

  function handleStreamEvent(event: AgentStreamEvent) {
    if (event.sessionId !== sessionId.value) {
      return;
    }

    switch (event.type) {
      case "delta":
        phase.value = "answering";
        appendDelta(event.text);
        break;
      case "reasoning_delta":
        phase.value = "thinking";
        appendReasoning(event.text);
        break;
      case "reasoning_end": {
        const last = lastAssistant();
        if (last) {
          last.reasoningMs = event.durationMs;
        }
        break;
      }
      case "tool_input_start":
        activeTool.value = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          message: "准备工具参数",
          state: "input-streaming",
        };
        statusText.value = `准备 ${event.toolName}`;
        break;
      case "tool_start":
        activeTool.value = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          message: "正在调用工具",
          state: "running",
        };
        statusText.value = `正在调用 ${event.toolName}`;
        break;
      case "tool_progress":
        activeTool.value = {
          toolCallId: event.event.toolCallId,
          toolName: event.event.toolName,
          message: event.event.message,
          percent: event.event.percent,
          state: "running",
        };
        statusText.value = event.event.message;
        break;
      case "tool_end": {
        toolHistory.value.push({
          id: event.toolCallId,
          toolName: event.toolName,
          summary: event.summary,
          ok: event.ok,
          output: event.output,
        });
        activeTool.value = null;
        statusText.value = event.summary;
        break;
      }
      case "approval_request":
        pendingApproval.value = {
          approvalId: event.request.approvalId,
          toolCallId: event.request.toolCallId,
          toolName: event.request.toolName,
          prompt: event.request.reason ?? `需要审批工具调用：${event.request.toolName}`,
          input: event.request.input,
        };
        statusText.value = "等待工具审批";
        break;
      case "approval_resolved":
        if (pendingApproval.value?.approvalId === event.approvalId) {
          pendingApproval.value = null;
        }
        statusText.value = event.approved ? "已批准" : "已拒绝";
        break;
      case "status":
        status.value = event.status;
        if (event.status === "paused") {
          isPaused.value = true;
          statusText.value = "已暂停";
        } else if (event.status === "awaiting-approval") {
          isPaused.value = false;
          statusText.value = "等待工具审批";
        } else {
          isPaused.value = false;
        }
        break;
      case "error":
        status.value = "error";
        lastError.value = event.message;
        statusText.value = event.message;
        break;
      case "usage":
        lastInputTokens.value = event.inputTokens;
        break;
      case "done":
        status.value = "idle";
        isPaused.value = false;
        activeTool.value = null;
        pendingApproval.value = null;
        statusText.value = event.reason === "cancelled" ? "已取消" : "";
        void refreshGit();
        break;
    }
  }

  function bootstrap(): () => void {
    const zen = window.zen;
    if (!zen) {
      status.value = "error";
      lastError.value = "preload bridge 未注入";
      statusText.value = lastError.value;
      return () => undefined;
    }

    void zen.app.info().then((info) => {
      appInfo.value = info;
    });
    void refreshGit();

    return zen.agent.onEvent(handleStreamEvent);
  }

  function buildHistory(): ChatTurn[] {
    return messages.value
      .filter((item) => item.role === "user" || item.role === "assistant")
      .map((item) => ({
        role: item.role as "user" | "assistant",
        content: item.content,
      }));
  }

  function addAttachment(file: File, path: string) {
    attachments.value.push({
      id: uuid(),
      name: file.name,
      path,
      size: file.size,
      isImage: file.type.startsWith("image/"),
    });
  }

  function removeAttachment(id: string) {
    attachments.value = attachments.value.filter((item) => item.id !== id);
  }

  async function send() {
    const zen = window.zen;
    const text = input.value.trim();
    if (!zen || isRunning.value || (!text && !attachments.value.length)) {
      return;
    }

    const modelsStore = useModelsStore();
    if (!modelsStore.selection.providerId || !modelsStore.selection.modelId) {
      await modelsStore.refresh();
    }

    const attachmentRefs: AttachmentRef[] = attachments.value.map((item) => ({
      name: item.name,
      path: item.path,
    }));

    lastError.value = "";
    input.value = "";
    attachments.value = [];
    if (sessionName.value === "新会话") {
      const first = text || attachmentRefs[0]?.name || "新会话";
      sessionName.value = first.slice(0, 24) + (first.length > 24 ? "…" : "");
      // 侧栏标题同步：落库 + 本地分组刷新
      void zen.session.rename(sessionId.value, sessionName.value);
      useWorkspaceStore().renameSessionLocal(sessionId.value, sessionName.value);
    }

    appendMessage({
      id: uuid(),
      role: "user",
      content: text,
      createdAt: Date.now(),
      meta: attachmentRefs.length ? { attachments: attachmentRefs } : undefined,
    });

    status.value = "thinking";
    isPaused.value = false;
    toolHistory.value = [];
    pendingApproval.value = null;
    activeTool.value = null;
    phase.value = "thinking";
    statusText.value = "Agent 思考中…";

    const result = await zen.agent.run({
      sessionId: sessionId.value,
      userMessage: text,
      workspaceRoot: workspaceRoot.value,
      workspaceId: sessionWorkspaceId.value,
      providerId: modelsStore.selection.providerId ?? undefined,
      model: modelsStore.selection.modelId ?? undefined,
      reasoningEffort: effort.value,
      attachments: attachmentRefs.length ? attachmentRefs : undefined,
      history: buildHistory().slice(0, -1),
    });

    if (!result.ok) {
      status.value = "error";
      lastError.value = result.error ?? "运行失败";
      statusText.value = lastError.value;
    }
  }

  async function cancel() {
    const zen = window.zen;
    if (!zen || !isRunning.value) {
      return;
    }
    await zen.agent.cancel(sessionId.value);
  }

  async function pause() {
    const zen = window.zen;
    if (!zen || !isRunning.value) {
      return;
    }
    await zen.agent.pause(sessionId.value);
  }

  async function resume() {
    const zen = window.zen;
    if (!zen || !isPaused.value) {
      return;
    }
    await zen.agent.resume(sessionId.value);
  }

  async function approve(approved: boolean) {
    const zen = window.zen;
    const approval = pendingApproval.value;
    if (!zen || !approval) {
      return;
    }
    const decision: ToolApprovalDecision = {
      approvalId: approval.approvalId,
      approved,
    };
    await zen.agent.resolveApproval(sessionId.value, decision);
  }

  function dismissApproval() {
    pendingApproval.value = null;
    statusText.value = "审批提示已收起";
  }

  /** 新会话：在工作区（缺省为当前工作区）建立持久会话 */
  async function newTask(workspaceId?: string) {
    if (isRunning.value) {
      await cancel();
    }
    flushDraft();
    messages.value = [];
    input.value = "";
    attachments.value = [];
    status.value = "idle";
    phase.value = "answering";
    isPaused.value = false;
    activeTool.value = null;
    toolHistory.value = [];
    pendingApproval.value = null;
    statusText.value = "";
    lastError.value = "";
    lastInputTokens.value = null;
    sessionName.value = "新会话";

    const workspaceStore = useWorkspaceStore();
    sessionWorkspaceId.value = workspaceId || workspaceStore.activeId;
    const zen = window.zen;
    if (zen) {
      const record = await zen.session.create(sessionWorkspaceId.value);
      sessionId.value = record.id;
      workspaceStore.appendSessionLocal(sessionWorkspaceId.value, record);
    } else {
      sessionId.value = uuid();
    }
    void refreshGit();
  }

  /** 打开历史会话：运行中的先取消，事件按 sessionId 过滤不会串流 */
  async function loadSession(record: SessionRecord) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    if (record.id === sessionId.value) {
      return;
    }
    if (isRunning.value) {
      await cancel();
    }
    const found = await zen.session.open(record.id);
    if (!found) {
      return;
    }
    flushDraft();
    sessionId.value = record.id;
    sessionName.value = found.session.title;
    sessionWorkspaceId.value = found.session.workspaceId ?? "common";
    messages.value = found.messages;
    input.value = found.session.draft ?? "";
    attachments.value = [];
    status.value = "idle";
    phase.value = "answering";
    isPaused.value = false;
    activeTool.value = null;
    toolHistory.value = [];
    pendingApproval.value = null;
    statusText.value = "";
    lastError.value = "";
    lastInputTokens.value = null;
    void refreshGit();
  }

  return {
    messages,
    input,
    status,
    phase,
    statusText,
    lastError,
    sessionId,
    sessionName,
    sessionWorkspaceId,
    appInfo,
    effort,
    attachments,
    activeTool,
    toolHistory,
    pendingApproval,
    isPaused,
    isRunning,
    hasMessages,
    canSend,
    workspaceRoot,
    branch,
    repo,
    contextUsage,
    bootstrap,
    handleStreamEvent,
    refreshGit,
    addAttachment,
    removeAttachment,
    send,
    cancel,
    pause,
    resume,
    approve,
    dismissApproval,
    newTask,
    loadSession,
  };
});

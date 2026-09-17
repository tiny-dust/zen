import { defineStore } from "pinia";
import { uuid } from "rattail";
import { computed, ref } from "vue";

import type {
  AgentRunStatus,
  AgentStreamEvent,
  AttachmentRef,
  ChatMessage,
  ReasoningEffort,
  SessionRecord,
  TaskItem,
  ToolApprovalDecision,
} from "@zen/shared";
import { buildHistory } from "@/stores/chat-types";
import { useAgentStore } from "@/stores/agent";
import { useGitStore } from "@/stores/git";
import { useModelsStore } from "@/stores/models";
import { useSessionDraft } from "@/composables/useSessionDraft";
import { useSessionInfoStore } from "@/stores/session-info";
import { useUserStore } from "@/stores/user";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AppInfo } from "@/types/zen-api";

import type {
  ActiveTool,
  ComposerAttachment,
  PendingApproval,
  RunPhase,
  ToolHistoryItem,
} from "@/stores/chat-types";
import type { AskUserQuestionEvent } from "@zen/shared";

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
  /** 输入区已选技能 tag（文本前方展示；发送时拼回 /skill 前缀传给 agent） */
  const skillMentions = ref<Array<{ label: string; insert: string }>>([]);
  const activeTool = ref<ActiveTool | null>(null);
  const toolHistory = ref<ToolHistoryItem[]>([]);
  /** tool_start 的入参缓存：tool_end 时写入消息 meta，供卡片展开 */
  const pendingToolArgs = ref(new Map<string, unknown>());
  /** 工具写文件后递增，驱动右侧文件面板刷新 */
  const filesRevision = ref(0);
  /** 本 run 内是否调用过 updateTasks（用于 checklist 兜底） */
  let usedUpdateTasks = false;
  const pendingApproval = ref<PendingApproval | null>(null);
  /** askUser 提问（展示在输入框上方，支持选项与自由输入） */
  const pendingAsk = ref<AskUserQuestionEvent | null>(null);
  const isPaused = ref(false);
  const branch = ref("");
  const repo = ref("");
  const lastInputTokens = ref<number | null>(null);

  const { flushDraft } = useSessionDraft(input, sessionId);

  const isRunning = computed(() =>
    ["thinking", "answering", "tool-running", "awaiting-approval"].includes(status.value),
  );
  const hasMessages = computed(() => messages.value.length > 0);
  const canSend = computed(
    () =>
      (input.value.trim().length > 0 ||
        attachments.value.length > 0 ||
        skillMentions.value.length > 0) &&
      !isRunning.value,
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

  /**
   * 兜底：模型没调 updateTasks、却在正文里写了 markdown 任务清单时，
   * 从最后一条助手消息提取 `- [ ]` / `- [x]` 列表，灌入会话信息卡。
   */
  function applyChecklistFallback() {
    const last = [...messages.value].reverse().find((item) => item.role === "assistant");
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
    useSessionInfoStore().applyTasksUpdated(sessionId.value, version, items);
    appendMessage({
      id: uuid(),
      role: "tool",
      content: "",
      createdAt: Date.now(),
      meta: { kind: "tasks", version, items, source: "checklist" },
    });
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
        pendingToolArgs.value.set(event.toolCallId, event.args);
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
        const args = pendingToolArgs.value.get(event.toolCallId);
        pendingToolArgs.value.delete(event.toolCallId);
        toolHistory.value.push({
          id: event.toolCallId,
          toolName: event.toolName,
          summary: event.summary,
          ok: event.ok,
          output: event.output,
        });
        // 工具调用进入消息时间线（可展开、带图标），与 MiMo 消息列表同构
        appendMessage({
          id: event.toolCallId || uuid(),
          role: "tool",
          content: event.summary,
          createdAt: Date.now(),
          toolCallId: event.toolCallId,
          meta: {
            toolName: event.toolName,
            ok: event.ok,
            summary: event.summary,
            output: event.output,
            args,
          },
        });
        if (event.toolName === "writeFile" || event.toolName === "editFile") {
          filesRevision.value += 1;
        }
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
      case "ask_user":
        pendingAsk.value = event.question;
        statusText.value = "等待你的回答";
        break;
      case "ask_resolved":
        if (pendingAsk.value?.askId === event.askId) {
          pendingAsk.value = null;
        }
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
      case "done": {
        status.value = "idle";
        isPaused.value = false;
        activeTool.value = null;
        pendingApproval.value = null;
        statusText.value = event.reason === "cancelled" ? "已取消" : "";
        if (!usedUpdateTasks && event.reason === "stop") {
          applyChecklistFallback();
        }
        usedUpdateTasks = false;
        void refreshGit();
        void useGitStore().refreshStatus();
        break;
      }
      case "tasks_updated": {
        usedUpdateTasks = true;
        useSessionInfoStore().applyTasksUpdated(event.sessionId, event.version, event.items);
        // 时间线插入一版任务快照（同版本覆盖上一张卡片）
        const version = event.version;
        const items = event.items;
        const existingIdx = messages.value.findIndex(
          (item) =>
            item.role === "tool" &&
            (item.meta as { kind?: string; version?: number } | undefined)?.kind === "tasks" &&
            (item.meta as { version?: number } | undefined)?.version === version,
        );
        const snapshot: ChatMessage = {
          id: existingIdx >= 0 ? messages.value[existingIdx]!.id : uuid(),
          role: "tool",
          content: "",
          createdAt: Date.now(),
          meta: { kind: "tasks", version, items },
        };
        if (existingIdx >= 0) {
          messages.value[existingIdx] = snapshot;
        } else {
          appendMessage(snapshot);
        }
        break;
      }
      case "reference_found":
        useSessionInfoStore().addReference(event.sessionId, event.reference);
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
    void useGitStore().refreshStatus();
    useSessionInfoStore().ensureSession(sessionId.value);

    return zen.agent.onEvent(handleStreamEvent);
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

  function addSkillMention(item: { label: string; insert: string }) {
    if (skillMentions.value.some((tag) => tag.insert === item.insert)) {
      return;
    }
    skillMentions.value.push({ label: item.label, insert: item.insert });
  }

  function removeSkillMention(insert: string) {
    skillMentions.value = skillMentions.value.filter((tag) => tag.insert !== insert);
  }

  async function send() {
    const zen = window.zen;
    // 技能 tag 在发送时拼回 /skill 前缀，agent 侧沿用原有文本信号
    const mentionPrefix = skillMentions.value.map((tag) => tag.insert.trim()).join(" ");
    const text = [mentionPrefix, input.value.trim()].filter(Boolean).join(" ");
    if (!zen || isRunning.value || (!text && !attachments.value.length)) {
      return;
    }
    // 未登录禁止使用（需求 1）：配置保留在本地，但 agent 会话需要 GitHub 登录
    if (!useUserStore().auth.loggedIn) {
      lastError.value = "请先在「个人资料」中登录 GitHub 后再使用";
      statusText.value = lastError.value;
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
    skillMentions.value = [];
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
    pendingToolArgs.value.clear();
    usedUpdateTasks = false;
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
      history: buildHistory(messages.value).slice(0, -1),
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

  /** 回答 askUser 提问（选项或自由输入） */
  async function submitAsk(answer: string) {
    const zen = window.zen;
    const ask = pendingAsk.value;
    if (!zen || !ask || !answer.trim()) {
      return;
    }
    pendingAsk.value = null;
    await zen.agent.resolveAsk(sessionId.value, { askId: ask.askId, answer: answer.trim() });
  }

  function dismissApproval() {
    pendingApproval.value = null;
    statusText.value = "审批提示已收起";
  }

  /** 新会话：在工作区（缺省为当前工作区）建立持久会话 */
  async function newTask(workspaceId?: string) {
    const workspaceStore = useWorkspaceStore();
    const target = workspaceId || workspaceStore.activeId;
    const zen = window.zen;
    if (isRunning.value) {
      await cancel();
    }
    flushDraft();

    // 先建库再切状态：创建失败时保留当前现场并提示
    let record: SessionRecord | undefined;
    if (zen) {
      try {
        record = await zen.session.create(target);
      } catch (error) {
        lastError.value = `创建会话失败：${error instanceof Error ? error.message : "未知错误"}`;
        statusText.value = lastError.value;
        return;
      }
    }

    messages.value = [];
    input.value = "";
    attachments.value = [];
    skillMentions.value = [];
    status.value = "idle";
    phase.value = "answering";
    isPaused.value = false;
    activeTool.value = null;
    toolHistory.value = [];
    pendingToolArgs.value.clear();
    usedUpdateTasks = false;
    pendingApproval.value = null;
    pendingAsk.value = null;
    statusText.value = "";
    lastError.value = "";
    lastInputTokens.value = null;
    sessionName.value = "新会话";
    useSessionInfoStore().clear();

    sessionWorkspaceId.value = target;
    if (record) {
      sessionId.value = record.id;
      workspaceStore.appendSessionLocal(target, record);
    } else {
      sessionId.value = uuid();
    }
    useSessionInfoStore().ensureSession(sessionId.value);
    void refreshGit();
    void useGitStore().refreshStatus();
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
    pendingToolArgs.value.clear();
    usedUpdateTasks = false;
    pendingApproval.value = null;
    pendingAsk.value = null;
    statusText.value = "";
    lastError.value = "";
    lastInputTokens.value = null;
    useSessionInfoStore().clear();
    useSessionInfoStore().ensureSession(sessionId.value);
    useSessionInfoStore().restoreFromSession(found);
    // 旧会话若无任务快照消息、只有 taskLists 表数据，补进时间线
    const hasTaskCard = messages.value.some(
      (item) =>
        item.role === "tool" &&
        (item.meta as { kind?: string } | undefined)?.kind === "tasks",
    );
    if (!hasTaskCard) {
      for (const list of found.taskLists ?? []) {
        messages.value.push({
          id: uuid(),
          role: "tool",
          content: "",
          createdAt: list.createdAt ?? Date.now(),
          meta: { kind: "tasks", version: list.version, items: list.items },
        });
      }
    }
    useGitStore().reset();
    void refreshGit();
    void useGitStore().refreshStatus();
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
    skillMentions,
    activeTool,
    toolHistory,
    pendingApproval,
    pendingAsk,
    isPaused,
    isRunning,
    hasMessages,
    canSend,
    workspaceRoot,
    branch,
    repo,
    contextUsage,
    filesRevision,
    bootstrap,
    handleStreamEvent,
    refreshGit,
    addAttachment,
    removeAttachment,
    addSkillMention,
    removeSkillMention,
    send,
    cancel,
    pause,
    resume,
    approve,
    submitAsk,
    dismissApproval,
    newTask,
    loadSession,
  };
});

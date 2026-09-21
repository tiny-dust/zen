import { defineStore } from "pinia";
import { uuid } from "rattail";
import { computed, ref, watch } from "vue";

import type {
  AgentDoneReason,
  AgentRunStatus,
  AgentStreamEvent,
  AttachmentRef,
  BrowserElementRef,
  ChatMessage,
  ChatRunSummary,
  ReasoningEffort,
  SessionRecord,
  TaskItem,
  ToolApprovalDecision,
  ToolCallMessageMeta,
} from "@zen/shared";
import { applyStreamToMessage, getMessageRun, restoreRunSummaryFromMessages } from "@zen/shared";
import { createElementMark, expandBrowserElementTokens } from "@/lib/browser-element";
import { playNotifySound } from "@/lib/notify-sound";
import type { ComposerElementMark } from "@/lib/browser-element";
import {
  buildHistory,
  compressHistory,
  pathFromToolArgs,
} from "@/stores/chat-types";
import { useAgentStore } from "@/stores/agent";
import { useAgentsStore } from "@/stores/agents";
import { useBrowserStore } from "@/stores/browser";
import { useGitStore } from "@/stores/git";
import { useModelsStore } from "@/stores/models";
import { useSessionDraft } from "@/composables/useSessionDraft";
import { useSessionInfoStore } from "@/stores/session-info";
import { useSessionStatusStore } from "@/stores/session-status";
import { useUserStore } from "@/stores/user";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AppInfo } from "@/types/zen-api";

import type {
  ComposerAttachment,
  PendingApproval,
  RunPhase,
  SelectedSkill,
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
  /** 工具写文件后递增，驱动右侧文件面板刷新 */
  const filesRevision = ref(0);
  /** 本 run 内是否调用过 updateTasks（用于 checklist 兜底） */
  let usedUpdateTasks = false;
  /** tool_start 入参暂存：tool_end 成功后据此把读写过的项目文件登记进参考 */
  const pendingToolArgs = new Map<string, { toolName: string; args: unknown }>();
  /** 手动压缩开关：点「压缩上下文」后置位，本会话后续发送都走摘要历史 */
  const forceCompress = ref(false);
  const pendingApproval = ref<PendingApproval | null>(null);
  /** askUser 提问（展示在输入框上方，支持选项与自由输入） */
  const pendingAsk = ref<AskUserQuestionEvent | null>(null);
  /** 外部模块请求「插入到 composer 光标处」的载荷（浏览器标注等） */
  const pendingComposerInsert = ref<{ text: string; id: number } | null>(null);
  /** 浏览器标注元素：正文内 `$el:id` 链接 + tooltip 明细 */
  const elementMarks = ref<ComposerElementMark[]>([]);
  let elementSeq = 0;
  const isPaused = ref(false);
  const branch = ref("");
  const repo = ref("");
  const lastInputTokens = ref<number | null>(null);
  const lastOutputTokens = ref<number | null>(null);
  const currentStep = ref<number | null>(null);
  const lastDoneReason = ref<AgentDoneReason | null>(null);
  const runSummary = ref<ChatRunSummary | null>(null);

  const { flushDraft } = useSessionDraft(input, sessionId);

  const isRunning = computed(() =>
    ["thinking", "answering", "tool-running", "awaiting-approval"].includes(status.value),
  );
  /** 本轮运行起点：消息流里展示已运行时长（审批等待计入本轮） */
  const runStartedAt = ref<number | null>(null);
  const sessionStatusStore = useSessionStatusStore();
  watch(isRunning, (running) => {
    runStartedAt.value = running ? (runStartedAt.value ?? Date.now()) : null;
    if (running && !pendingApproval.value && !pendingAsk.value) {
      sessionStatusStore.set(sessionId.value, "running");
    }
  });
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
  }

  function lastAssistant(): ChatMessage | undefined {
    const last = messages.value.at(-1);
    return last?.role === "assistant" ? last : undefined;
  }

  /** 流式助手消息：无助手消息时先建一条空的（模型不输出正文直接调工具时也需要） */
  function ensureAssistantMessage(): ChatMessage {
    let last = lastAssistant();
    if (!last) {
      const message: ChatMessage = {
        id: uuid(),
        role: "assistant",
        content: "",
        parts: [],
        createdAt: Date.now(),
      };
      messages.value.push(message);
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
    runSummary.value = summary;
    if (summary.reason) lastDoneReason.value = summary.reason;
    if (summary.step != null) currentStep.value = summary.step;
    if (summary.usage) {
      lastInputTokens.value = summary.usage.inputTokens;
      lastOutputTokens.value = summary.usage.outputTokens;
    }
    if (summary.error) lastError.value = summary.error;
  }

  function handleStreamEvent(event: AgentStreamEvent) {
    if (event.sessionId !== sessionId.value) {
      return;
    }

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
        phase.value = "answering";
        break;
      case "reasoning_delta":
        phase.value = "thinking";
        break;
      case "reasoning_end":
        break;
      case "tool_input_start":
        break;
      case "tool_start":
        pendingToolArgs.set(event.toolCallId, { toolName: event.toolName, args: event.args });
        // Agent 需要用浏览器时：自动打开右栏浏览器面板并导航
        if (typeof event.toolName === "string" && event.toolName.startsWith("browser")) {
          useBrowserStore().onAgentBrowserTool(event.toolName, event.args);
        }
        break;
      case "tool_progress":
        break;
      case "tool_end": {
        // 读写文件成功 → 收进悬浮面板「参考 · 项目」（按路径去重）
        const pending = pendingToolArgs.get(event.toolCallId);
        pendingToolArgs.delete(event.toolCallId);
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
          filesRevision.value += 1;
        }
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
        sessionStatusStore.set(sessionId.value, "needs_action");
        playNotifySound("needsAction");
        break;
      case "approval_resolved":
        if (pendingApproval.value?.approvalId === event.approvalId) {
          pendingApproval.value = null;
        }
        statusText.value = event.approved ? "已批准，等待执行" : "已拒绝";
        if (isRunning.value && !pendingApproval.value && !pendingAsk.value) {
          sessionStatusStore.set(sessionId.value, "running");
        }
        break;
      case "ask_user":
        pendingAsk.value = event.question;
        statusText.value = "等待你的回答";
        sessionStatusStore.set(sessionId.value, "needs_action");
        playNotifySound("needsAction");
        break;
      case "ask_resolved":
        if (pendingAsk.value?.askId === event.askId) {
          pendingAsk.value = null;
        }
        if (isRunning.value && !pendingApproval.value && !pendingAsk.value) {
          sessionStatusStore.set(sessionId.value, "running");
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
        lastError.value = event.message;
        statusText.value = event.message;
        syncRunRefsFromMessage(ensureAssistantMessage());
        break;
      case "step_start":
        currentStep.value = event.step;
        break;
      case "usage":
        lastInputTokens.value = event.inputTokens;
        lastOutputTokens.value = event.outputTokens;
        break;
      case "done": {
        const message = ensureAssistantMessage();
        syncRunRefsFromMessage(message);
        const reason = runSummary.value?.reason ?? event.reason;
        lastDoneReason.value = reason;
        status.value = reason === "error" ? "error" : "idle";
        isPaused.value = false;
        pendingApproval.value = null;
        pendingAsk.value = null;
        statusText.value =
          reason === "cancelled"
            ? "已取消"
            : reason === "max_steps"
              ? "已达到步骤上限"
              : reason === "error"
                ? (lastError.value || "运行失败")
                : "已完成";
        sessionStatusStore.set(sessionId.value, reason === "error" ? "error" : "done");
        playNotifySound(reason === "error" ? "error" : "done");
        if (!usedUpdateTasks && reason === "stop") {
          applyChecklistFallback();
        }
        usedUpdateTasks = false;
        pendingToolArgs.clear();
        void refreshGit();
        void useGitStore().refreshStatus();
        break;
      }
      case "tasks_updated": {
        // 任务清单只更新会话信息卡（悬浮面板）；不再往时间线插快照卡片
        usedUpdateTasks = true;
        useSessionInfoStore().applyTasksUpdated(event.sessionId, event.version, event.items);
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
    useAgentsStore().ensureSession(sessionId.value);

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

  /** 正文里的内联技能 token（/skill:名称）→ SelectedSkill（发送时进 meta.skills 渲染 tag） */
  function extractSkills(text: string): SelectedSkill[] {
    const known = useAgentStore().skills;
    const found: SelectedSkill[] = [];
    for (const match of text.matchAll(/\/skill:([^\s/]+)/g)) {
      const name = match[1] ?? "";
      if (!name || found.some((item) => item.name === name)) {
        continue;
      }
      const info = known.find((item) => item.name === name);
      found.push({
        name,
        description: info?.description ?? "",
        dir: info?.dir,
        source: info?.source,
      });
    }
    return found;
  }

  function removeAttachment(id: string) {
    attachments.value = attachments.value.filter((item) => item.id !== id);
  }

  /** 会话里 Agent 读写过的文件路径（流式 parts + 旧数据 tool 消息，去重） */
  function collectTouchedFiles(): string[] {
    const files: string[] = [];
    for (const message of messages.value) {
      for (const part of message.parts ?? []) {
        if (part.type !== "tool") {
          continue;
        }
        const path = pathFromToolArgs(part.toolName, part.args);
        if (path) {
          files.push(path);
        }
      }
      if (message.role === "tool") {
        const meta = message.meta as Partial<ToolCallMessageMeta> | undefined;
        if (meta?.toolName) {
          const path = pathFromToolArgs(meta.toolName, meta.args);
          if (path) {
            files.push(path);
          }
        }
      }
    }
    return [...new Set(files)];
  }

  /** 历史消息里用户上传过的文件名（去重） */
  function collectUploads(): string[] {
    const names: string[] = [];
    for (const message of messages.value) {
      if (message.role !== "user") {
        continue;
      }
      const meta = message.meta as { attachments?: Array<{ name: string }> } | undefined;
      for (const att of meta?.attachments ?? []) {
        if (att.name) {
          names.push(att.name);
        }
      }
    }
    return [...new Set(names)];
  }

  /** 手动压缩：下一次发送起使用摘要历史（会话内保持） */
  function compressNow() {
    if (!hasMessages.value) {
      return;
    }
    forceCompress.value = true;
    statusText.value = "已开启压缩：下一次发送起，更早对话将折叠为摘要";
  }

  async function send() {
    const zen = window.zen;
    const text = input.value.trim();
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

    // 技能已以内联 token（/skill:名称）写在正文里，随消息直接发给 Agent；
    // meta.skills 供气泡渲染 tag（正文展示时会隐藏 token）
    const skills = extractSkills(text);
    // `$el:id` 链接展开为完整元素描述，便于 Agent 定位
    const usedMarks = elementMarks.value.filter((mark) => text.includes(mark.token));
    const agentText = expandBrowserElementTokens(text, usedMarks);

    lastError.value = "";
    lastDoneReason.value = null;
    runSummary.value = null;
    currentStep.value = null;
    lastInputTokens.value = null;
    lastOutputTokens.value = null;
    input.value = "";
    attachments.value = [];
    elementMarks.value = [];
    sessionStatusStore.set(sessionId.value, "running");
    useAgentsStore().ensureSession(sessionId.value);

    // 上传的文件收进悬浮面板「参考 · 用户」（按路径去重）
    if (attachmentRefs.length) {
      const sessionInfo = useSessionInfoStore();
      for (const att of attachmentRefs) {
        sessionInfo.addReference(sessionId.value, {
          id: "",
          title: att.name,
          url: att.path,
          source: "user",
        });
      }
    }

    if (sessionName.value === "新会话") {
      const first = text || skills[0]?.name || attachmentRefs[0]?.name || "新会话";
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
      meta: {
        ...(skills.length ? { skills } : {}),
        ...(attachmentRefs.length ? { attachments: attachmentRefs } : {}),
        ...(usedMarks.length
          ? {
              elementMarks: usedMarks.map((mark) => ({
                id: mark.id,
                label: mark.label,
                token: mark.token,
                ref: mark.ref,
              })),
            }
          : {}),
      },
    });

    status.value = "thinking";
    isPaused.value = false;
    usedUpdateTasks = false;
    pendingApproval.value = null;
    phase.value = "thinking";
    statusText.value = "Agent 思考中…";

    // 滚动摘要 + 超限双保险：手动压缩或上下文用量超阈值时折叠旧轮次
    const sessionInfo = useSessionInfoStore();
    const compression = compressHistory(buildHistory(messages.value).slice(0, -1), {
      tasks: sessionInfo.activeTasks.map((item) => ({ label: item.label, done: item.done })),
      touchedFiles: collectTouchedFiles(),
      uploads: collectUploads(),
      force: forceCompress.value,
      overThreshold: (contextUsage.value ?? 0) >= 70,
    });
    if (compression.compressed) {
      statusText.value = "已压缩上下文 · Agent 思考中…";
    }

    const result = await zen.agent.run({
      sessionId: sessionId.value,
      userMessage: agentText,
      workspaceRoot: workspaceRoot.value,
      workspaceId: sessionWorkspaceId.value,
      providerId: modelsStore.selection.providerId ?? undefined,
      model: modelsStore.selection.modelId ?? undefined,
      reasoningEffort: effort.value,
      attachments: attachmentRefs.length ? attachmentRefs : undefined,
      history: compression.turns,
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

  async function approve(approved: boolean, always = false) {
    const zen = window.zen;
    const approval = pendingApproval.value;
    if (!zen || !approval) {
      return;
    }
    const decision: ToolApprovalDecision = {
      approvalId: approval.approvalId,
      approved,
      ...(always ? { always } : {}),
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
    status.value = "idle";
    phase.value = "answering";
    isPaused.value = false;
    usedUpdateTasks = false;
    pendingApproval.value = null;
    pendingAsk.value = null;
    statusText.value = "";
    lastError.value = "";
    lastInputTokens.value = null;
    lastOutputTokens.value = null;
    currentStep.value = null;
    lastDoneReason.value = null;
    runSummary.value = null;
    sessionName.value = "新会话";
    forceCompress.value = false;
    pendingToolArgs.clear();
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
    usedUpdateTasks = false;
    pendingApproval.value = null;
    pendingAsk.value = null;
    statusText.value = "";
    lastError.value = "";
    lastInputTokens.value = null;
    lastOutputTokens.value = null;
    currentStep.value = null;
    lastDoneReason.value = null;
    runSummary.value = null;
    forceCompress.value = false;
    pendingToolArgs.clear();
    useSessionInfoStore().clear();
    useSessionInfoStore().ensureSession(sessionId.value);
    useSessionInfoStore().restoreFromSession(found);
    // 从最后一条 assistant 的 meta.run 恢复 run summary
    const restored = restoreRunSummaryFromMessages(found.messages);
    if (restored) {
      runSummary.value = restored;
      if (restored.reason) lastDoneReason.value = restored.reason;
      if (restored.step != null) currentStep.value = restored.step;
      if (restored.usage) {
        lastInputTokens.value = restored.usage.inputTokens;
        lastOutputTokens.value = restored.usage.outputTokens;
      }
      if (restored.error) lastError.value = restored.error;
    }
    useGitStore().reset();
    void refreshGit();
    void useGitStore().refreshStatus();
  }

  function insertAtComposerCaret(text: string) {
    if (!text) {
      return;
    }
    pendingComposerInsert.value = { text, id: Date.now() };
  }

  /** 浏览器标注：登记元素并以 `$el:标签` tag 插入光标处 */
  function insertBrowserElement(ref: BrowserElementRef) {
    elementSeq += 1;
    const used = new Set(elementMarks.value.map((item) => item.label));
    const mark = createElementMark(ref, elementSeq, used);
    elementMarks.value = [...elementMarks.value, mark];
    insertAtComposerCaret(`${mark.token} `);
    return mark;
  }

  function removeElementMark(id: string) {
    const mark = elementMarks.value.find((item) => item.id === id);
    elementMarks.value = elementMarks.value.filter((item) => item.id !== id);
    if (mark && input.value.includes(mark.token)) {
      input.value = input.value.split(mark.token).join("").replace(/\s{2,}/g, " ");
    }
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
    elementMarks,
    insertBrowserElement,
    removeElementMark,
    pendingApproval,
    pendingAsk,
    pendingComposerInsert,
    insertAtComposerCaret,
    isPaused,
    isRunning,
    runStartedAt,
    hasMessages,
    canSend,
    workspaceRoot,
    branch,
    repo,
    contextUsage,
    lastInputTokens,
    lastOutputTokens,
    currentStep,
    lastDoneReason,
    runSummary,
    filesRevision,
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
    submitAsk,
    dismissApproval,
    compressNow,
    newTask,
    loadSession,
  };
});

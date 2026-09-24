import { defineStore } from "pinia";
import { uuid } from "rattail";
import { computed, ref, watch } from "vue";

import type {
  AgentDoneReason,
  AgentRunStatus,
  AgentStreamEvent,
  AskUserQuestionEvent,
  AttachmentRef,
  ChatMessage,
  ChatRunSummary,
  ReasoningEffort,
  SessionRecord,
} from "@zen/shared";
import { restoreRunSummaryFromMessages, uuidv7 } from "@zen/shared";
import { expandBrowserElementTokens } from "@/lib/browser-element";
import { useAgentStore } from "@/stores/agent";
import { useAgentProcessesStore } from "@/stores/agent-processes";
import { useAgentsStore } from "@/stores/agents";
import { createChatEventGateway } from "@/stores/chat-events";
import { BackgroundTranscripts } from "@/stores/chat-background";
import type { ComposerAttachment, PendingApproval, RunPhase } from "@/stores/chat-types";
import { buildHistory, estimateHistoryTokens } from "@/stores/chat-types";
import { createCompressionDomain } from "@/stores/chat-compress";
import { createComposerDomain } from "@/stores/chat-composer";
import { createMessageQueue } from "@/stores/chat-queue";
import { useGitStore } from "@/stores/git";
import { useModelsStore } from "@/stores/models";
import { useSessionDraft } from "@/composables/useSessionDraft";
import { useSessionInfoStore } from "@/stores/session-info";
import { useSessionStatusStore } from "@/stores/session-status";
import { useSkillUsageStore } from "@/stores/skill-usage";
import { useWorkspaceStore } from "@/stores/workspace";
import type { AppInfo } from "@/types/zen-api";

/** 后台会话消息缓冲：非响应式普通对象，切走的运行中会话事件持续归约进缓冲 */
const backgroundTranscripts = new BackgroundTranscripts();

export const useChatStore = defineStore("chat", () => {
  const messages = ref<ChatMessage[]>([]);
  const input = ref("");
  const status = ref<AgentRunStatus>("idle");
  const phase = ref<RunPhase>("answering");
  const statusText = ref("");
  const lastError = ref("");
  // 会话唯一 key 用 uuidv7：创建即生成，侧栏高亮/事件路由都按它区分
  const sessionId = ref(uuidv7());
  const sessionName = ref("新会话");
  /** 会话是否已落库；启动后的本地会话在首发消息前补建，避免 agent:run 报 session not found */
  const sessionPersisted = ref(false);
  /** 当前会话归属的工作区（'common' = 公共区），决定 agent 工作目录与 git 信息来源 */
  const sessionWorkspaceId = ref<string>(useWorkspaceStore().activeId || "common");
  const appInfo = ref<AppInfo | null>(null);
  const effort = ref<ReasoningEffort>("off");
  const attachments = ref<ComposerAttachment[]>([]);
  /** 工具写文件后递增，驱动右侧文件面板刷新 */
  const filesRevision = ref(0);
  /** 本 run 是否调用过 updateTasks（done 时决定是否走 checklist 兜底） */
  const usedUpdateTasks = ref(false);
  /** tool_start 入参暂存：tool_end 成功后据此把读写过的项目文件登记进参考 */
  const pendingToolArgs = new Map<string, { toolName: string; args: unknown }>();
  /**
   * 会话级压缩模式：点「压缩上下文」后置位，之后每次发送都折叠更早对话；
   * 自动超限折叠成功也会保持。切换会话时复位。
   */
  const forceCompress = ref(false);
  const pendingApproval = ref<PendingApproval | null>(null);
  /** askUser 提问队列（可多问询并发；展示在输入框上方） */
  const pendingAsks = ref<AskUserQuestionEvent[]>([]);
  /**
   * 非当前会话的挂起问询暂存（含后台会话新到的 ask_user）：
   * 切走的会话保留其问询卡，切回时恢复；主进程仍在等待应答，不能丢。
   */
  const stashedAsks = new Map<string, AskUserQuestionEvent[]>();

  /** 切走当前会话前：把挂起问询按旧 sessionId 暂存并清空当前队列 */
  function stashPendingAsks() {
    if (pendingAsks.value.length) {
      stashedAsks.set(sessionId.value, pendingAsks.value);
      pendingAsks.value = [];
    }
  }

  /** 切入会话后：恢复该会话的挂起问询（无则清空，防串台） */
  function restorePendingAsks(id: string) {
    pendingAsks.value = stashedAsks.get(id) ?? [];
    stashedAsks.delete(id);
  }
  /** 兼容单卡视图：队首问询（ChatComposer v-if 用） */
  const pendingAsk = computed(() => pendingAsks.value[0] ?? null);
  const isPaused = ref(false);
  const branch = ref("");
  const repo = ref("");
  const lastInputTokens = ref<number | null>(null);
  const lastOutputTokens = ref<number | null>(null);
  const currentStep = ref<number | null>(null);
  const lastDoneReason = ref<AgentDoneReason | null>(null);
  const runSummary = ref<ChatRunSummary | null>(null);

  const { flushDraft } = useSessionDraft(input, sessionId);

  // ---------- 输入框域：附件 / 浏览器标注 / 技能 token / 外部插入 ----------
  const composer = createComposerDomain({ input, attachments });
  const {
    elementMarks,
    pendingComposerInsert,
    addAttachment,
    removeAttachment,
    extractSkills,
    insertAtComposerCaret,
    insertBrowserElement,
    removeElementMark,
  } = composer;

  const isRunning = computed(() =>
    insertActive.value ||
    ["thinking", "answering", "tool-running", "awaiting-approval"].includes(status.value),
  );

  // ---------- 插入消息队列：运行中入队，run 正常结束后按序续发 ----------
  const queue = createMessageQueue({ input, isRunning, send });

  /**
   * 插入执行进行中：原 run 已被打断（checkpoint 保留），插入 run 正在跑。
   * 期间 isRunning 保持 true（暂停落点会短暂发 status=paused，不能让 canSend 变 true），
   * original_resumed 后复位。
   */
  const insertActive = ref(false);

  /** 队列条「插入执行」：打断当前 run，该消息以最高权重先执行，完成后原任务自动续跑 */
  async function insertQueued(id: string) {
    const zen = window.zen;
    const item = queue.queuedMessages.value.find((entry) => entry.id === id);
    if (!zen || !item || !isRunning.value) {
      return;
    }
    queue.remove(id);
    insertActive.value = true;
    // 本地先展示（带「已插入」徽标）；插入 run 的流事件会另起新助手气泡衔接在后面
    const localMessage: ChatMessage = {
      id: uuid(),
      role: "user",
      content: item.text,
      createdAt: Date.now(),
      meta: { inserted: true },
    };
    appendMessage(localMessage);
    status.value = "thinking";
    phase.value = "thinking";
    statusText.value = "插入执行中…";
    sessionStatusStore.set(sessionId.value, "running");

    const result = await zen.agent.insert(sessionId.value, item.text);
    if (!result.ok) {
      // 插入失败（如正在等审批/提问）：消息退回队首不丢，气泡撤下，错误走 lastError
      insertActive.value = false;
      const index = messages.value.indexOf(localMessage);
      if (index >= 0) {
        messages.value.splice(index, 1);
      }
      queue.queuedMessages.value = [item, ...queue.queuedMessages.value];
      lastError.value = result.error ?? "插入执行失败";
      statusText.value = lastError.value;
    }
  }

  /** 本轮运行起点：消息流里展示已运行时长（审批等待计入本轮） */
  const runStartedAt = ref<number | null>(null);
  const sessionStatusStore = useSessionStatusStore();
  watch(isRunning, (running) => {
    runStartedAt.value = running ? (runStartedAt.value ?? Date.now()) : null;
    if (running && !pendingApproval.value && !pendingAsks.value.length) {
      sessionStatusStore.set(sessionId.value, "running");
    }
  });
  const hasMessages = computed(() => messages.value.length > 0);
  const canSend = computed(
    () => (input.value.trim().length > 0 || attachments.value.length > 0) && !isRunning.value,
  );
  const workspaceRoot = computed(() => appInfo.value?.workspaceRoot ?? "");

  const contextWindowTokens = computed(
    () => useModelsStore().selectedModel?.capabilities?.contextWindow ?? 0,
  );
  /** 本地估算当前输入 token（消息文本 + 系统/工具固定开销）；API 未回 usage 时兜底 */
  const estimatedInputTokens = computed(() => estimateHistoryTokens(buildHistory(messages.value)));
  /** 上次请求输入占用（%）：API 上报的 inputTokens（含系统提示/工具/历史），无数据为 null */
  const lastRequestUsage = computed(() => {
    if (!contextWindowTokens.value || lastInputTokens.value == null) {
      return null;
    }
    return Math.min(100, Math.round((lastInputTokens.value / contextWindowTokens.value) * 100));
  });
  /** 估算当前占用（%）：按现有消息粗估的下一次请求输入 */
  const estimatedUsage = computed(() => {
    if (!contextWindowTokens.value) {
      return null;
    }
    return Math.min(100, Math.round((estimatedInputTokens.value / contextWindowTokens.value) * 100));
  });
  /**
   * 上下文用量（%）：优先真实「上次请求输入」，无 API usage 时用本地估算兜底。
   * 两个来源在 EnvInfoSection 分开展示；压缩阈值取两者较大值更稳妥。
   */
  const contextUsage = computed(() => {
    const last = lastRequestUsage.value;
    const estimated = estimatedUsage.value;
    if (last != null && estimated != null) {
      return Math.max(last, estimated);
    }
    return last ?? estimated;
  });

  // ---------- 历史压缩域：手动压缩 / 发送前折叠 / 摘要卡 ----------
  const compressionDomain = createCompressionDomain({
    messages,
    sessionId,
    statusText,
    forceCompress,
    contextUsage: () => contextUsage.value,
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

  // ---------- 自动会话标题：首条消息发送后记下，run 完成时用模型升级 ----------
  const autoTitleSessionId = ref("");
  const autoTitleUserText = ref("");

  async function maybeAutoTitle() {
    const zen = window.zen;
    if (!zen || !autoTitleSessionId.value || autoTitleSessionId.value !== sessionId.value) {
      return;
    }
    const targetId = autoTitleSessionId.value;
    const userText = autoTitleUserText.value;
    // 只升级一次；重复触发直接跳过
    autoTitleSessionId.value = "";
    const titleBefore = sessionName.value;
    // tsconfig lib 低于 es2023，不用 Array.prototype.findLast
    let lastReply: string | undefined;
    for (let i = messages.value.length - 1; i >= 0; i -= 1) {
      const message = messages.value[i];
      if (message?.role === "assistant") {
        lastReply = message.content;
        break;
      }
    }
    const title = await zen.session.autoTitle(userText, lastReply || undefined);
    // 等待期间切换会话或用户手动改过名 → 放弃
    if (!title || sessionId.value !== targetId || sessionName.value !== titleBefore) {
      return;
    }
    sessionName.value = title;
    void zen.session.rename(targetId, title);
    useWorkspaceStore().renameSessionLocal(targetId, title);
  }

  // ---------- 流事件网关：事件归约 + 审批/提问应答 ----------
  /** 切走当前会话前：若其仍在运行，快照消息进后台缓冲，切回时可恢复未落库的流式内容 */
  function stashRunningTranscript() {
    const bgStatus = sessionStatusStore.get(sessionId.value);
    if (
      isRunning.value ||
      bgStatus === "running" ||
      bgStatus === "needs_action"
    ) {
      backgroundTranscripts.stash(sessionId.value, messages.value);
    }
  }

  const { handleStreamEvent, approve, submitAsk, dismissApproval } = createChatEventGateway({
    sessionId,
    messages,
    status,
    phase,
    statusText,
    lastError,
    isRunning,
    isPaused,
    insertActive,
    runSummary,
    lastDoneReason,
    currentStep,
    lastInputTokens,
    lastOutputTokens,
    pendingApproval,
    pendingAsks,
    stashedAsks,
    pendingToolArgs,
    filesRevision,
    usedUpdateTasks,
    queuedMessages: queue.queuedMessages,
    backgroundTranscripts,
    scheduleQueuedDispatch: queue.scheduleDispatch,
    refreshGit: () => {
      void refreshGit();
    },
    onRunFinished: () => {
      void maybeAutoTitle();
    },
  });

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
    useAgentProcessesStore().ensureSession(sessionId.value);

    return zen.agent.onEvent(handleStreamEvent);
  }

  // ---------- 插入对话（编辑分叉）与重试：从历史某条起重发，其后分支被替换 ----------
  /** 编辑插入锚点：被编辑的用户消息 id；发送前从该消息起截断旧分支 */
  const editAnchorId = ref("");

  /** 从某条消息起截断其后所有分支（内存 + 落库），编辑插入/重试共用 */
  async function truncateFrom(messageId: string) {
    const zen = window.zen;
    const index = messages.value.findIndex((item) => item.id === messageId);
    if (index < 0) {
      return;
    }
    const fromCreatedAt = messages.value[index].createdAt;
    messages.value = messages.value.slice(0, index);
    if (zen) {
      await zen.session.trimMessages(sessionId.value, fromCreatedAt);
    }
  }

  /** 编辑并插入对话：内容与附件/标注回填输入框，发送时从该消息处分叉 */
  function startEditFrom(message: ChatMessage) {
    const meta = message.meta as
      | {
          elementMarks?: Array<{ id: string; label: string; token: string; ref: unknown }>;
          attachments?: Array<{ name: string; path?: string }>;
        }
      | undefined;
    elementMarks.value = (meta?.elementMarks ?? []).map((item) => ({
      id: item.id,
      label: item.label,
      token: item.token,
      ref: item.ref as never,
    })) as typeof elementMarks.value;
    attachments.value = (meta?.attachments ?? []).map((item) => ({
      id: uuid(),
      name: item.name,
      path: item.path ?? "",
      size: 0,
      isImage: /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(item.name),
    }));
    input.value = message.content;
    editAnchorId.value = message.id;
  }

  function cancelEdit() {
    editAnchorId.value = "";
  }

  /** 重试（重新生成）：从该消息所属轮次的用户消息起，同内容分叉重跑 */
  async function retryFrom(messageId: string) {
    if (isRunning.value) {
      return;
    }
    const index = messages.value.findIndex((item) => item.id === messageId);
    if (index < 0) {
      return;
    }
    let userIndex = -1;
    for (let i = index; i >= 0; i -= 1) {
      if (messages.value[i].role === "user") {
        userIndex = i;
        break;
      }
    }
    const origin = messages.value[userIndex];
    if (!origin) {
      return;
    }
    startEditFrom(origin);
    await send();
  }

  async function send() {
    const zen = window.zen;
    const text = input.value.trim();
    if (!zen || (!text && !attachments.value.length)) {
      return;
    }
    // 运行中不打断当前 run：消息插入队列，输入框顶部队列条可编辑/删除/插队
    if (isRunning.value) {
      if (text) {
        queue.enqueue(text);
        input.value = "";
      }
      return;
    }
    // 编辑插入（分叉）：先从被编辑消息起截断旧分支（内存 + 落库），再走正常发送
    if (editAnchorId.value) {
      await truncateFrom(editAnchorId.value);
      editAnchorId.value = "";
    }
    // 免登录可用：会话与本地 Agent 功能不依赖 GitHub；仅云同步等账号功能需登录

    // 首发消息前补建持久会话（启动后的本地会话此前不在库里，会报 session not found）
    await ensurePersistedSession();

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
    // 输入框上方「本会话调用」tag：用户随消息携带的技能即刻可见
    if (skills.length) {
      useSkillUsageStore().noteSkills(sessionId.value, skills.map((item) => item.name));
    }
    // `$el:id` 链接展开为完整元素描述，便于 Agent 定位
    const usedMarks = elementMarks.value.filter((mark) => text.includes(mark.token));
    const agentText = expandBrowserElementTokens(text, usedMarks);

    lastError.value = "";
    lastDoneReason.value = null;
    runSummary.value = null;
    currentStep.value = null;
    // 不清空 lastInputTokens/lastOutputTokens：既是运行中的上下文统计，
    // 也是下一次发送判断超限压缩的依据（清空会让 overThreshold 永远不触发）
    input.value = "";
    attachments.value = [];
    elementMarks.value = [];
    sessionStatusStore.set(sessionId.value, "running");
    useAgentsStore().ensureSession(sessionId.value);
    useAgentProcessesStore().ensureSession(sessionId.value);

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
      // 首次发送即记录，run 完成后用模型生成更好的标题
      if (text) {
        autoTitleSessionId.value = sessionId.value;
        autoTitleUserText.value = text;
      }
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
    usedUpdateTasks.value = false;
    pendingApproval.value = null;
    phase.value = "thinking";
    statusText.value = "Agent 思考中…";

    // 滚动摘要 + 超限双保险：手动压缩或上下文用量超阈值时折叠旧轮次
    const { compression } = compressionDomain.prepareCompression();

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
    const result = await zen.agent.cancel(sessionId.value);
    if (!result.ok) {
      // 主进程已无此 run（渲染层重载后状态失联等）：本地直接落终态，
      // 否则会话永远停在「运行中」，停止按钮看似失灵
      status.value = "idle";
      phase.value = "answering";
      isPaused.value = false;
      insertActive.value = false;
      statusText.value = "已停止";
      sessionStatusStore.set(sessionId.value, "done");
    }
  }

  async function pause() {
    const zen = window.zen;
    if (!zen || !isRunning.value) {
      return;
    }
    const result = await zen.agent.pause(sessionId.value);
    if (!result.ok && result.error === "session not running") {
      // 与 cancel 同源的失联兜底：主进程已无 run，无法暂停，落终态避免卡死
      status.value = "idle";
      phase.value = "answering";
      isPaused.value = false;
      statusText.value = "已停止";
      sessionStatusStore.set(sessionId.value, "done");
    }
  }

  async function resume() {
    const zen = window.zen;
    if (!zen || !isPaused.value) {
      return;
    }
    await zen.agent.resume(sessionId.value);
  }

  /**
   * 会话切换序号：loadSession/newTask 是多步异步（open/create 在前、状态赋值在后），
   * 快速连续点击时慢的那个后返回会覆盖新会话的选中态与草稿（选中异常、输入内容丢失）。
   * 每次切换递增，await 返回后序号不一致说明已有更新的切换，本次结果整体丢弃。
   */
  let switchSeq = 0;

  /** 切换/新建会话时的运行态复位（消息、输入、队列由调用方各自处理） */
  function resetRunState() {
    status.value = "idle";
    phase.value = "answering";
    isPaused.value = false;
    insertActive.value = false;
    queue.clear();
    editAnchorId.value = "";
    usedUpdateTasks.value = false;
    pendingApproval.value = null;
    pendingAsks.value = [];
    statusText.value = "";
    lastError.value = "";
    lastInputTokens.value = null;
    lastOutputTokens.value = null;
    currentStep.value = null;
    lastDoneReason.value = null;
    runSummary.value = null;
    forceCompress.value = false;
    pendingToolArgs.clear();
  }

  /** 首发消息前补建持久会话：沿用当前 id，避免 agent:run 因会话不在库里报 session not found */
  async function ensurePersistedSession() {
    const zen = window.zen;
    if (!zen || sessionPersisted.value) {
      return;
    }
    try {
      const record = await zen.session.create(sessionWorkspaceId.value, sessionId.value);
      sessionPersisted.value = true;
      useWorkspaceStore().appendSessionLocal(sessionWorkspaceId.value, record);
    } catch (error) {
      lastError.value = `创建会话失败：${error instanceof Error ? error.message : "未知错误"}`;
      statusText.value = lastError.value;
    }
  }

  /** 新会话：缺省落在底部当前选中的工作区/公共区，与 WorkspacePicker 一致 */
  async function newTask(workspaceId?: string) {
    const workspaceStore = useWorkspaceStore();
    const target = workspaceId || sessionWorkspaceId.value;
    const zen = window.zen;
    // 运行中的会话切到后台继续跑（主进程按 sessionId 隔离，支持多会话并行），
    // 侧栏状态由 sessionStatusStore 标记「进行中」，不在此 cancel
    flushDraft();
    const seq = ++switchSeq;

    // 先建库再切状态：创建失败时保留当前现场并提示。
    // 会话 id 由渲染层生成（uuidv7），保证每个会话有唯一 key，不依赖 DB 兜底
    const newId = uuidv7();
    let record: SessionRecord | undefined;
    if (zen) {
      try {
        record = await zen.session.create(target, newId);
      } catch (error) {
        lastError.value = `创建会话失败：${error instanceof Error ? error.message : "未知错误"}`;
        statusText.value = lastError.value;
        return;
      }
    }
    // 创建期间用户又点了其他会话：丢弃本次新建，避免覆盖新的选中态
    if (seq !== switchSeq) {
      return;
    }

    // 切走前快照：当前会话仍在后台运行时，把未落库的流式消息存进后台缓冲
    stashRunningTranscript();
    stashPendingAsks();

    messages.value = [];
    input.value = "";
    attachments.value = [];
    resetRunState();
    sessionName.value = "新会话";
    useSessionInfoStore().clear();
    useAgentsStore().clear();
    useAgentProcessesStore().clear();

    sessionWorkspaceId.value = target;
    workspaceStore.setActive(target);
    if (record) {
      sessionId.value = record.id || newId;
      sessionPersisted.value = true;
      workspaceStore.appendSessionLocal(target, record);
    } else {
      sessionId.value = newId;
      sessionPersisted.value = false;
    }
    useSessionInfoStore().ensureSession(sessionId.value);
    useAgentsStore().ensureSession(sessionId.value);
    useAgentProcessesStore().ensureSession(sessionId.value);
    restorePendingAsks(sessionId.value);
    void refreshGit();
    void useGitStore().refreshStatus();
  }

  /** 打开历史会话：运行中的会话切到后台继续跑，事件按 sessionId 过滤不会串流 */
  async function loadSession(record: SessionRecord) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    if (record.id === sessionId.value) {
      return;
    }
    // 切换前先同步落草稿：此时 sessionId 还是旧会话，输入内容归属正确；
    // 原实现放在 await session.open 之后，快速连续切换时会把输入写串
    flushDraft();
    const seq = ++switchSeq;

    const found = await zen.session.open(record.id);
    if (!found || seq !== switchSeq) {
      // 打开失败，或等待期间用户又点了其他会话/新建：丢弃本次结果，
      // 否则慢返回的旧请求会覆盖新会话（选中异常、输入框内容被换掉）
      return;
    }
    // 切走前快照：旧会话（此时 sessionId.value 还是旧 id）仍在后台运行时，
    // 把未落库的流式消息存进后台缓冲
    stashRunningTranscript();
    stashPendingAsks();
    sessionId.value = record.id;
    sessionPersisted.value = true;
    // 重新打开即视为已读：清除侧栏「已完成 / 失败」结果圆点
    sessionStatusStore.markSeen(record.id);
    sessionName.value = found.session.title;
    sessionWorkspaceId.value = found.session.workspaceId ?? "common";
    // 目标会话仍在后台运行且缓冲存在 → 缓冲优先（含切走后未落库的流式内容）；
    // 否则用数据库恢复，并清掉过期缓冲
    const bgStatus = sessionStatusStore.get(record.id);
    const bgResumable = bgStatus === "running" || bgStatus === "needs_action";
    const buffered = bgResumable ? backgroundTranscripts.take(record.id) : undefined;
    if (!buffered) {
      backgroundTranscripts.drop(record.id);
    }
    messages.value = buffered ?? found.messages;
    input.value = found.session.draft ?? "";
    attachments.value = [];
    resetRunState();
    // 切回仍在后台运行的会话：恢复运行态（isRunning=true），
    // 让 send() 走队列而不是再次 agent:run 顶掉后台 run；后续流事件正常流入展示
    if (bgResumable) {
      status.value = bgStatus === "needs_action" ? "awaiting-approval" : "thinking";
      phase.value = "answering";
      isPaused.value = false;
    }
    // 恢复该会话挂起的 askUser 问询（切走时暂存 / 后台新到的），否则问询卡不显示
    restorePendingAsks(record.id);
    useSessionInfoStore().clear();
    useAgentsStore().clear();
    useAgentProcessesStore().clear();
    useSessionInfoStore().ensureSession(sessionId.value);
    useAgentsStore().ensureSession(sessionId.value);
    useAgentProcessesStore().ensureSession(sessionId.value);
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

  /** composer 底栏：把当前会话切到工作区目录或公共区（决定 agent 工作目录与侧栏分组） */
  async function setSessionWorkspace(workspaceId: string) {
    if (workspaceId === sessionWorkspaceId.value) {
      return;
    }
    sessionWorkspaceId.value = workspaceId;
    useWorkspaceStore().setActive(workspaceId);
    const zen = window.zen;
    if (zen && sessionPersisted.value) {
      await zen.session.setWorkspace(sessionId.value, workspaceId);
      // 侧栏分组跟着迁移
      useWorkspaceStore().removeSessionLocal(sessionId.value);
      useWorkspaceStore().appendSessionLocal(workspaceId, {
        id: sessionId.value,
        title: sessionName.value,
        workspaceId: workspaceId === "common" ? null : workspaceId,
        draft: "",
        pinned: false,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
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
    elementMarks,
    insertBrowserElement,
    removeElementMark,
    pendingApproval,
    pendingAsk,
    pendingAsks,
    pendingComposerInsert,
    insertAtComposerCaret,
    isPaused,
    isRunning,
    queuedMessages: queue.queuedMessages,
    editQueued: queue.edit,
    removeQueued: queue.remove,
    promoteQueued: queue.promote,
    insertQueued,
    insertActive,
    runStartedAt,
    hasMessages,
    canSend,
    workspaceRoot,
    branch,
    repo,
    contextUsage,
    lastRequestUsage,
    estimatedUsage,
    estimatedInputTokens,
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
    startEditFrom,
    cancelEdit,
    retryFrom,
    editAnchorId,
    approve,
    submitAsk,
    dismissApproval,
    compressNow: compressionDomain.compressNow,
    newTask,
    loadSession,
    setSessionWorkspace,
  };
});

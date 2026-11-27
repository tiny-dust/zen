import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { AgentSession, runMockAgent } from "@zen/agent-core";

import { withAttachmentManifest } from "./agent-attachments";
import { loadImageAttachments, isImagePath, withImageAnalysisText } from "./agent-images";
import { getAgentServicesRegistry } from "./agent-services";
import { buildApprovalGate } from "./approval-gate";
import { getCuaService } from "./abilities/cua";
import { detectCliRuntimes, startCliRun } from "./cli-runtime";
import { getBrowserRegistry } from "./browser/service";
import { getChatGptAuthStatus, resolveChatGptCredentials } from "./chatgpt-auth";
import { chatGptRequestTarget } from "./model-api";
import { notifyLarkEvent } from "./lark/ipc";
import { notifyTaskEvent } from "./tasks/runtime";
import {
  appendMemoryNote,
  readMemoryNotes,
  readMemorySnapshot,
  renderMemoryContext,
} from "./memory";
import {
  maybeAutoIngest,
  readConversationSettings,
  readPersonaBlock,
  renderRecallBlock,
} from "./memory-conversations";
import { enabledMcpTools } from "./mcp-ipc";
import { inspectModelCapabilities } from "./model-capabilities";
import { chatGptUsageAccountKey, recordProviderUsage } from "./model-usage";
import { getSelection, listProviders, loadProviderApiKey, isChatGptAuthProvider } from "./model-db";
import { resolvePromptText } from "./prompt-presets";
import { recordPetRunEvent, registerPetRun } from "./pet-service";
import { resolveWorkspaceDir } from "./sandbox";
import { resolveSessionWorktreeRoot } from "./session-worktree";
import { loadAppSettings } from "./user-ipc";
import {
  backupAfterWrite,
  backupWorkspaceFile,
  beginTurnCheckpoint,
} from "./session-checkpoints";
import { getWebSearchApiKeys } from "./websearch-auth-store";
import { isWorkflowSessionActive } from "./workflow-ipc";
import { loadAgentSettings, sessionCacheDir } from "./zen-dir";
import {
  appendSessionModelHistory,
  appendMessage,
  createSession,
  createWorkspace,
  ensureSessionTitle,
  getSession as loadSessionRecord,
  getWorkspace,
  listWorkspaceGroups,
  loadSessionModelHistory,
  recordGoalUsage,
  rewriteSessionModelHistory,
  saveTaskList,
  setSessionMode,
} from "./workspace-db";
import {
  appendGoalDirective,
  appendPlanDirective,
  appendSessionModeDirective,
  isPlanApproval,
  resolvePhaseModel,
  resolveRunSessionMode,
  shouldAutoPlan,
} from "./session-mode";

import type { AgentImageAttachment } from "@zen/agent-core";
import { expandElementTokens } from "@zen/tools-browser";
import type {
  AgentDoneReason,
  AgentRunRequest,
  AgentStreamEvent,
  BrowserElementRef,
  ChatMessage,
  ChatTurn,
  PhaseModelRef,
  SessionGoal,
  SessionMode,
  SessionRecord,
  TaskItem,
} from "@zen/shared";
import { applyStreamToMessage, getMessageRun, shouldPersistAssistantMessage } from "@zen/shared";

/**
 * Agent run 驱动：原 index.ts agent:run handler 主体抽出，供渲染层 IPC 与飞书网关共用。
 * - 渲染层入口：send 传入 webContents 回传包装，行为与原实现完全一致；
 * - 飞书入口：不传 send（流事件只落库 + notifyLarkEvent 推送），并提供按项目路径
 *   找不到工作区时 createWorkspace + createSession 建新会话的 startLarkChat。
 */

export interface RunAgentOptions {
  sessions: Map<string, AgentSession>;
  /** 渲染层事件回传（agent:event 频道）；飞书入口不传 */
  send?: (event: AgentStreamEvent) => void;
}

export interface AgentRunResult {
  ok: boolean;
  error?: string;
}

/** 助手回复（含思考文本）在 run 真正结束后一次性落库；run summary 本身也算有效内容 */
function persistAssistant(sessionId: string, message: ChatMessage): void {
  if (!shouldPersistAssistantMessage(message)) {
    return;
  }
  const run = getMessageRun(message);
  const parts = message.parts ?? [];
  // createdAt 用落库时刻（run 结束），而非 accMessage 创建时刻：
  // 否则助手消息与用户消息同毫秒（创建即落库），读取排序时顺序不稳定
  appendMessage(sessionId, {
    id: message.id,
    role: "assistant",
    content: message.content,
    reasoning: message.reasoning || undefined,
    reasoningMs: message.reasoningMs,
    parts,
    meta: run ? { ...message.meta, run } : message.meta,
    createdAt: Date.now(),
  });
}

/**
 * 系统提示词里的记忆块：既有设备/习惯记忆 + 本轮召回（对话记忆启用且开了 recall 时）。
 * 记忆任何环节失败都不阻塞聊天：召回抛错吞掉，只注入已有部分。
 */
async function buildMemoryContext(query: string): Promise<string | undefined> {
  const base = await readMemorySnapshot()
    .then(renderMemoryContext)
    .catch(() => undefined);
  let recall: string | undefined;
  let persona: string | undefined;
  try {
    const settings = await readConversationSettings();
    if (settings.enabled && settings.recall) {
      recall = await renderRecallBlock(settings, query);
    }
    if (settings.enabled) {
      persona = await readPersonaBlock();
    }
  } catch {
    // 召回/档案失败（文件损坏 / 读取异常）直接跳过，不影响本轮对话
    recall = undefined;
    persona = undefined;
  }
  return [base, persona, recall]
    .filter((part): part is string => Boolean(part))
    .join("\n\n") || undefined;
}

/**
 * 一轮 run 正常结束后的对话记忆自动摘要：fire-and-forget。
 * 先看设置（关闭时不读消息、不调模型），节流与失败记录都在 memory-conversations 内处理。
 */
function scheduleAutoIngest(sessionId: string, workspaceId: string): void {
  void (async () => {
    const settings = await readConversationSettings();
    if (!settings.enabled || !settings.autoSummarize) {
      return;
    }
    const messages = (loadSessionRecord(sessionId)?.messages ?? [])
      .filter(
        (item): item is ChatMessage & { role: "user" | "assistant" } =>
          item.role === "user" || item.role === "assistant",
      )
      .map((item) => ({ role: item.role, content: item.content }));
    await maybeAutoIngest(sessionId, workspaceId, messages);
  })().catch((error) => {
    // 自动摘要失败不能影响聊天主流程
    console.warn("[memory] 对话记忆自动摘要失败:", error);
  });
}

/** 单段 run 的附加选项：编排层（plan → act）用它区分阶段 */
interface PhaseRunOptions {
  /** 强制会话模式：计划段固定为 plan（只读） */
  forcedMode?: SessionMode;
  /** 计划段：成功 done 只落库、不推给渲染层（run 还没结束） */
  suppressDoneToUi?: boolean;
  /** 收集本段正文（计划文本） */
  collectText?: boolean;
  /** 执行段：注入上一段产出的计划 */
  planContext?: string;
}

interface PhaseRunResult extends AgentRunResult {
  text?: string;
  doneReason?: AgentDoneReason;
}

/**
 * 统一两阶段管线：有独立计划模型时，先跑 plan 段（只读、plan 模型），
 * 再跑 act 段（执行模型）带着计划落地；done 只在最后一段推给渲染层。
 * 手动「计划」模式不在这里串联——它本身就是 plan 段，等用户批准后再执行。
 */
export async function runAgentRequest(
  request: AgentRunRequest,
  options: RunAgentOptions,
): Promise<AgentRunResult> {
  if (request.runtimeCli) {
    return runCliRuntimeRequest(request, options);
  }
  return runAgentSinglePhase(request, options);
}

/** 运行中的 CLI 进程：sessionId → 停止函数（agent:cancel 与同会话重发都走它） */
const cliRuns = new Map<string, () => void>();

/** 停止会话的 CLI 进程；没有在跑返回 false（供 agent:cancel 回退判断） */
export function stopCliRun(sessionId: string): boolean {
  const stop = cliRuns.get(sessionId);
  if (!stop) {
    return false;
  }
  cliRuns.delete(sessionId);
  stop();
  return true;
}

export function isCliRunActive(sessionId: string): boolean {
  return cliRuns.has(sessionId);
}

/**
 * 外部 CLI 会话：提示词交给本机 CLI，stdout 作为正文流；失败透出 stderr 尾部。
 * 审批边界：CLI 自己执行工具，Zen 无法逐次确认——「默认权限」下明确拒绝，不静默放行。
 */
async function runCliRuntimeRequest(
  request: AgentRunRequest,
  options: RunAgentOptions,
): Promise<AgentRunResult> {
  const sessionId = request.sessionId;
  const runtimeId = request.runtimeCli;
  if (!sessionId || !request.userMessage || !runtimeId) {
    return { ok: false, error: "invalid agent run request" };
  }
  const record = loadSessionRecord(sessionId);
  if (!record) {
    return { ok: false, error: "session not found" };
  }

  const settings = await loadAgentSettings();
  if (settings.permissionMode === "default") {
    return {
      ok: false,
      error: "外部 CLI 无法提供逐次审批：请把权限切换到「智能」或「完全访问」，或改回 API 模型",
    };
  }

  const runtime = detectCliRuntimes().find((item) => item.id === runtimeId);
  if (!runtime?.path) {
    return { ok: false, error: `${runtimeId} 未安装或不在 PATH 中` };
  }

  const cwd =
    request.workspaceRoot ||
    getWorkspace(record.session.workspaceId)?.path ||
    process.cwd();

  // 同会话重发：先收掉上一轮还在跑的 CLI，避免两个进程抢同一份工作区
  stopCliRun(sessionId);

  ensureSessionTitle(sessionId, request.userMessage.slice(0, 24));
  const displayId = request.display?.id;
  appendMessage(sessionId, {
    id: typeof displayId === "string" && displayId.trim() ? displayId : randomUUID(),
    role: "user",
    content: request.display?.content ?? request.userMessage,
    createdAt: Date.now(),
    meta: request.attachments?.length ? { attachments: request.attachments } : undefined,
  });

  const startedAt = Date.now();
  let text = "";
  let stoppedByUser = false;
  const run = startCliRun({
    id: runtimeId,
    path: runtime.path,
    prompt: request.userMessage,
    cwd,
    onDelta: (chunk) => {
      text += chunk;
      options.send?.({ type: "delta", sessionId, text: chunk });
    },
  });
  cliRuns.set(sessionId, () => {
    stoppedByUser = true;
    run.stop();
  });

  const result = await run.done;
  cliRuns.delete(sessionId);

  const reason: AgentDoneReason = stoppedByUser ? "cancelled" : result.ok ? "stop" : "error";
  persistAssistant(sessionId, {
    id: randomUUID(),
    role: "assistant",
    content: text,
    createdAt: Date.now(),
    meta: {
      run: {
        reason,
        status: reason === "error" ? "error" : "idle",
        ...(result.error && reason === "error" ? { error: result.error } : {}),
        startedAt,
        endedAt: Date.now(),
      },
    },
  });

  if (reason === "error" && result.error) {
    options.send?.({ type: "error", sessionId, message: result.error });
  }
  options.send?.({ type: "done", sessionId, reason });
  return reason === "error" ? { ok: false, error: result.error } : { ok: true };
}

async function runAgentSinglePhase(
  request: AgentRunRequest,
  options: RunAgentOptions,
  phase: PhaseRunOptions = {},
): Promise<PhaseRunResult> {
  const { sessions, send } = options;
  if (!request?.sessionId || !request.userMessage) {
    return { ok: false, error: "invalid agent run request" };
  }
  if (isWorkflowSessionActive(request.sessionId)) {
    return { ok: false, error: "Session already running a workflow" };
  }
  // 前置（查会话/落库/清旧 run）失败同样只走 {ok:false}：
  // 这里抛出会让 agent:run IPC reject，渲染层 send() 无兜底，运行态卡死
  // 会话模式：前置块解析（plan 批准消息先落库切回 interactive），后续 AgentSession 组装要用
  let runMode: SessionMode = "interactive";
  let phaseSession: SessionRecord | null = null;
  // 会话目标（Goals 目标模式）：active 时追加进系统提示词（同会话模式指令的注入点）
  let runGoal: SessionGoal | null = null;
  // 任务清单跨轮次续用：版本号接着会话已落库的最大版本，清单以最新版初始化
  let taskListSeed: { version: number; items: TaskItem[] } | undefined;
  try {
    // 会话由 session:create 建立；不存在直接拒绝，避免 FK 落库失败
    const record = loadSessionRecord(request.sessionId);
    if (!record) {
      return { ok: false, error: "session not found" };
    }
    runMode =
      phase.forcedMode ??
      resolveRunSessionMode(
        record.session.mode,
        request,
        (mode) => setSessionMode(request.sessionId, mode),
      );
    phaseSession = record.session;
    runGoal = record.session.goal ?? null;
    const latestTaskList = record.taskLists.at(-1);
    if (latestTaskList && latestTaskList.items.length) {
      taskListSeed = { version: latestTaskList.version, items: latestTaskList.items };
    }

    // 首条消息把「新会话」改成摘要标题；用户消息与附件先行持久化。
    // 自动两阶段的内层 run（plan 段 / act 段）复用同一条 request，不能再落一次，
    // 否则一次发送会存下 2-3 条同样的用户消息。
    if (!phase.forcedMode && !phase.planContext) {
      ensureSessionTitle(request.sessionId, request.userMessage.slice(0, 24));
      // 落库优先用展示版（原始正文 + meta.elementMarks 等）：userMessage 是给 Agent 的展开文本，
      // 直接落库会让切会话/重启后恢复的气泡丢失元素 tag
      const userMeta: Record<string, unknown> = {
        ...(request.attachments?.length ? { attachments: request.attachments } : {}),
        ...(request.display?.meta ?? {}),
      };
      // 渲染层自带的乐观气泡 id 优先：落库与本地同 id，切回运行中会话时
      // 数据库与后台缓冲按 id 去重，同一条发送不会显示两条。非法值回落自生成。
      const displayId = request.display?.id;
      appendMessage(request.sessionId, {
        id: typeof displayId === "string" && displayId.trim() ? displayId : randomUUID(),
        role: "user",
        content: request.display?.content ?? request.userMessage,
        createdAt: Date.now(),
        meta: Object.keys(userMeta).length ? userMeta : undefined,
      });
    }

    await sessions.get(request.sessionId)?.cancel();
    sessions.delete(request.sessionId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "agent run failed" };
  }

  // 流式累积助手回复：与 UI 共用 applyStreamToMessage；仅 done/明确错误终态落库。
  // 插入执行会打断 run 一次（原 run → 插入 run → 原 run 续跑），
  // 在 insert_started / original_resumed 边界轮换 accMessage，三段各自成一条助手消息落库。
  let accMessage: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    parts: [],
  };
  let persisted = false;
  let usageProviderId: string | null = null;
  let usageModelId: string | null = null;
  let usageAccountKey: string | null = null;
  const petRunId = randomUUID();
  let petSession: AgentSession | null = null;
  const persistRun = () => {
    if (persisted) {
      return;
    }
    persistAssistant(request.sessionId, accMessage);
    persisted = true;
  };
  const rotateAcc = () => {
    persistRun();
    accMessage = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      parts: [],
    };
    persisted = false;
  };
  let collectedText = "";
  let phaseDoneReason: AgentDoneReason | undefined;
  const emitTo = (streamEvent: AgentStreamEvent) => {
    if (phase.collectText && streamEvent.type === "delta") {
      collectedText += streamEvent.text;
    }
    if (streamEvent.type === "done") {
      phaseDoneReason = streamEvent.reason;
    }
    // 长驻服务的终端输出尾部：runTerminal 的流式进度同步进服务登记表，
    // 右栏「服务」面板据此展示实时输出（面板点击条目打开）
    if (
      streamEvent.type === "tool_progress" &&
      streamEvent.event.toolName === "runTerminal" &&
      streamEvent.event.outputTail
    ) {
      getAgentServicesRegistry()?.appendOutput(streamEvent.sessionId, streamEvent.event.outputTail);
    }
    // 飞书桥接：ask_user / ask_resolved / done 事件喂给网关（推送与待答清理）
    notifyLarkEvent(streamEvent);
    // 持续任务：done 事件驱动 `app.run.finished` 触发器（tasks/runtime 内做冷却与排队）
    notifyTaskEvent(streamEvent);
    if (petSession && !(streamEvent.type === "done" && streamEvent.phase === "insert")) {
      recordPetRunEvent(streamEvent, petSession, petRunId);
    }
    if (streamEvent.sessionId !== request.sessionId) {
      send?.(streamEvent);
      return;
    }
    if (streamEvent.type === "usage") {
      if (usageProviderId && usageModelId && usageAccountKey !== null) {
        try {
          recordProviderUsage(usageProviderId, usageModelId, streamEvent, Date.now(), usageAccountKey, request.sessionId);
        } catch (error) {
          // 用量统计失败不能中断 Agent 的流式响应。
          console.warn("[zen] 供应商用量落库失败", error);
        }
      }
      if (runGoal?.status === "active") {
        // 使用流内每步的真实用量累计；消息 meta.run.usage 只保存最近一次事件。
        try {
          recordGoalUsage(request.sessionId, runGoal.text, streamEvent.inputTokens, streamEvent.outputTokens);
        } catch (error) {
          // 用量落库失败不能中断正在执行的 Agent；当前会话仍可由渲染层显示实时用量。
          console.warn("[zen] 目标用量落库失败", error);
        }
      }
    }
    if (streamEvent.type === "tasks_updated") {
      // 任务清单只进 task_lists 表（悬浮面板恢复用）；不再写入消息流
      saveTaskList(request.sessionId, streamEvent.version, streamEvent.items);
    } else if (
      streamEvent.type === "insert_started" ||
      streamEvent.type === "original_resumed" ||
      streamEvent.type === "sub_agent_retry_started"
    ) {
      // 续跑边界：已完成的上一段只落库一次，此后事件归入新回复
      rotateAcc();
    } else if (streamEvent.type !== "reference_found") {
      applyStreamToMessage(accMessage, streamEvent);
    }
    // 持久化绑定 done：暂停/等审批不是 run 终点，resume 后继续写同一条
    if (streamEvent.type === "done") {
      persistRun();
      // 计划段成功收尾：run 还没结束（后面还有执行段），只落库不通知渲染层
      if (phase.suppressDoneToUi && streamEvent.reason === "stop") {
        return;
      }
    }
    send?.(streamEvent);
  };

  try {
    const selection = await getSelection();
    // 阶段模型优先级：会话阶段覆盖 → 设置页全局阶段默认 → 会话/请求模型（含自动路由结果）。
    // 设置读取失败（磁盘异常等）不阻塞 run：回落到会话模型，保持既有行为。
    let phaseDefaults: { planModel?: PhaseModelRef | null; actModel?: PhaseModelRef | null } | undefined;
    try {
      const appSettings = await loadAppSettings();
      phaseDefaults = { planModel: appSettings.planModel, actModel: appSettings.actModel };
    } catch (error) {
      console.warn("[zen] 阶段模型默认读取失败，回落会话模型", error);
    }
    const fallback = {
      providerId: request.providerId || selection.providerId,
      modelId: request.model || selection.modelId,
    };

    const routed = resolvePhaseModel(
      phaseSession!,
      runMode,
      fallback,
      phaseDefaults,
    );
    const providerId = routed.providerId;
    const modelId = routed.modelId;
    const provider = (await listProviders()).find((item) => item.id === providerId);

    if (!provider || !modelId) {
      const controller = new AbortController();
      await runMockAgent(request.sessionId, request.userMessage, controller.signal, emitTo);
      // mock 始终发 done；此处兜底防止遗漏
      persistRun();
      return { ok: true };
    }

    usageProviderId = provider.id;
    usageModelId = modelId;

    const capabilities = isChatGptAuthProvider(provider)
      ? provider.models.find((item) => item.id === modelId)?.capabilities ?? inspectModelCapabilities(modelId)
      : inspectModelCapabilities(modelId);
    // 模型级对话端点覆盖优先（如 Responses-only 的 gpt-6 系列），否则沿用供应商协议
    const protocol = isChatGptAuthProvider(provider)
      ? "openai-responses"
      : capabilities.chatEndpoint && capabilities.chatEndpoint !== "auto"
        ? capabilities.chatEndpoint
        : provider.protocol;

    // 附件图片路由：视觉模型 → 原生多模态 part；非视觉模型 → 视觉兜底预分析
    let runUserMessage = request.userMessage;
    let sessionImages: AgentImageAttachment[] | undefined;
    const imageRefs = (request.attachments ?? []).filter((att) =>
      isImagePath(att.path || att.name),
    );
    if (imageRefs.length) {
      if (capabilities.vision === true) {
        sessionImages = await loadImageAttachments(imageRefs);
      } else {
        runUserMessage = await withImageAnalysisText(request.userMessage, imageRefs, {
          providerId: provider.id,
          modelId,
        });
      }
    }
    // 附件路径清单：$名称 引用对模型只是文本，注入路径后 Agent 才能读到
    // 工作区外的上传文件（视觉模型看到的图片同样需要路径来保存/处理）
    runUserMessage = withAttachmentManifest(runUserMessage, request.attachments);

    // ChatGPT 方案登录：access_token 走 apiKey 通道（Bearer）；
    // 其余供应商走静态 API Key
    let apiKey: string;
    let authHeaders: Record<string, string> | undefined;
    /** 实际请求端点：Codex 账号走 ChatGPT 后端，Zen 自注册账号走公开 API */
    let runBaseUrl = provider.baseUrl;
    if (isChatGptAuthProvider(provider)) {
      const credentials = await resolveChatGptCredentials(provider.id);
      apiKey = credentials.accessToken;
      const authStatus = await getChatGptAuthStatus(provider.id);
      usageAccountKey = chatGptUsageAccountKey(credentials.accountId ?? authStatus.accountId, authStatus.email);
      const target = chatGptRequestTarget(credentials);
      runBaseUrl = target.baseUrl;
      authHeaders = Object.keys(target.headers).length ? target.headers : undefined;
    } else {
      apiKey = await loadProviderApiKey(provider.id);
      usageAccountKey = "";
    }

    // agent 域配置：权限模式、提示词、技能路径；工作区按沙箱模式解析实际目录
    const agentSettings = await loadAgentSettings();
    const projectPath = getWorkspace(request.workspaceId)?.path;
    let workspaceRoot: string;
    if (projectPath) {
      workspaceRoot =
        (await resolveSessionWorktreeRoot(request.sessionId, projectPath)) ??
        (await resolveWorkspaceDir(projectPath, agentSettings.sandboxMode)).dir;
    } else {
      // 无项目会话（公共区）：Agent 产物落 ~/.zen/cache/sessions/<sessionId>，
      // 不再落到用户主目录/应用启动 cwd；mkdir 保证目录先于首次写文件存在
      workspaceRoot = sessionCacheDir(request.sessionId);
      await mkdir(workspaceRoot, { recursive: true });
    }

    // MCP 准备可能在连接或枚举工具时挂起；本轮有界等待，超时只跳过工具，不取消会话/连接。
    let mcpTimer: ReturnType<typeof setTimeout> | undefined;
    const boundedMcpTools = Promise.race([
      enabledMcpTools().catch(() => []),
      new Promise<Awaited<ReturnType<typeof enabledMcpTools>>>((resolve) => {
        mcpTimer = setTimeout(() => {
          console.warn("[mcp] 工具准备超时，本轮不加载 MCP 工具");
          resolve([]);
        }, 10_000);
      }),
    ]).finally(() => clearTimeout(mcpTimer));

    // 技能与 MCP 惰性汇总（失败不阻塞会话）
    // skill-router 正文一并取出：作为系统提示常驻段落，保证新会话也有技能路由（不依赖模型主动 loadSkill）
    const [skills, skillRouter, mcpTools] = await Promise.all([
      import("@zen/skills")
        .then(({ listSkills }) => listSkills(agentSettings.skillExtraPaths))
        .then((items) =>
          items.map((item) => ({ id: item.id, name: item.name, description: item.description })),
        )
        .catch(() => []),
      import("@zen/skills")
        .then(({ readSkillById }) => readSkillById("skill-router", agentSettings.skillExtraPaths))
        .then((found) => found?.body ?? "")
        .catch(() => ""),
      boundedMcpTools,
    ]);

    // 每轮 run 开始处打 turn 标记：本轮（含子 Agent/插入执行）全部文件改动
    // 归属同一 run 序号，供「文件快照」区按轮分组撤销/重新套用；失败不阻塞 run
    let checkpointRun = 1;
    try {
      checkpointRun = await beginTurnCheckpoint(request.sessionId);
    } catch (error) {
      console.warn("[checkpoints] turn 标记失败:", error);
    }

    // 跨轮回放：上一轮持久化的全量 ModelMessage（含工具调用/结果）字节级重发，
    // 前缀命中服务商 prompt 缓存；旧会话/分叉重发后无记录则回落 ChatTurn 兜底。
    // 读取放在旧会话 cancel 之后（旧会话残留 step 的迟滞写回已被持久化开关挡住）
    let modelHistory = null;
    try {
      modelHistory = loadSessionModelHistory(request.sessionId);
    } catch (error) {
      console.warn("[model-history] 载入失败，回落 ChatTurn 历史:", error);
    }

    // 两阶段编排：会话开启 P/A 双模型 + 非 plan 模式 + 配了独立计划模型 →
    // 先跑只读计划段（plan 模型），再带着计划跑执行段（act 模型）。
    // 递归进入本函数，phase 参数防止再次编排。
    if (!phase.forcedMode && !phase.planContext) {
      const planRef =
        phaseSession?.planModelProviderId && phaseSession.planModelId
          ? { providerId: phaseSession.planModelProviderId, modelId: phaseSession.planModelId }
          : phaseDefaults?.planModel ?? null;
      const actRef = resolvePhaseModel(phaseSession!, runMode, fallback, phaseDefaults);
      if (
        !isPlanApproval(request.userMessage, request.approvePlan) &&
        shouldAutoPlan({
          // 只有会话开启 P/A 双模型才编排两阶段；计划模式是另一维度，不决定是否双模型
          pairMode: phaseSession?.pairMode === true,
          mode: runMode,
          planProviderId: planRef?.providerId,
          planModelId: planRef?.modelId,
          actProviderId: actRef.providerId,
          actModelId: actRef.modelId,
          background: request.background,
          autoPlan: request.autoPlan,
        })
      ) {
        options.send?.({ type: "phase_start", sessionId: request.sessionId, phase: "plan" });
        const planRun = await runAgentSinglePhase(request, options, {
          forcedMode: "plan",
          suppressDoneToUi: true,
          collectText: true,
        });
        const planText = (planRun.text ?? "").trim();
        // 计划段失败/取消/暂停/无正文：不再进入执行段
        if (!planRun.ok || !planText || (planRun.doneReason && planRun.doneReason !== "stop")) {
          return planRun;
        }
        options.send?.({ type: "phase_start", sessionId: request.sessionId, phase: "act" });
        return runAgentSinglePhase(request, options, { planContext: planText });
      }
    }


    // 计划文本由编排层注入：计划段是独立的只读 run
    const planContext = phase.planContext ?? "";

    const session = new AgentSession({
      sessionId: request.sessionId,
      workspaceRoot,
      protocol,
      baseUrl: runBaseUrl,
      apiKey,
      model: modelId,
      chatgptPlan: isChatGptAuthProvider(provider),
      // 已知上下文窗口下发给 agent-core：run 内步间按真实 usage 主动压缩；未知则不主动压缩
      contextWindow: capabilities.contextWindow,
      reasoningEffort: request.reasoningEffort,
      reasoning: capabilities.reasoning === true,
      authHeaders,
      permissionMode: agentSettings.permissionMode,
      planReadOnly: runMode === "plan",
      // 会话模式指令追加在基础提示词之后（interactive 不追加，保持现状）；
      // 目标指令再追加在其后（仅 active 目标注入，预算不进提示词）
      systemPrompt: appendPlanDirective(
        appendGoalDirective(
          appendSessionModeDirective(
            resolvePromptText(agentSettings),
            runMode,
            agentSettings.permissionMode,
          ),
          runGoal,
        ),
        planContext,
      ),
      // 任务清单：版本号接着会话已落库的最大版本，新一轮 startNew 才真正开新版
      taskListSeed,
      // 设备环境 + 用户习惯记忆（+ 对话记忆召回，开启时）：注入系统提示词
      memoryContext: await buildMemoryContext(request.userMessage).catch(() => undefined),
      memoryBridge: {
        appendNote: async (scope, text, category) => {
          await appendMemoryNote(scope, text, category);
          return { ok: true };
        },
        // 设备备注在提示词里只有分类索引：readMemory 工具按需读正文
        readNotes: async (scope, category) => {
          const notes = await readMemoryNotes(scope, category);
          return notes.map((note) => ({ text: note.text, category: note.category }));
        },
      },
      multiAgent: runMode !== "plan",
      skills,
      skillRouter,
      skillExtraPaths: agentSettings.skillExtraPaths,
      mcpTools,
      // 后台会话必须使用自己的浏览器 scope，不能借用用户当前正在看的工作区视图。
      browserBridge: getBrowserRegistry().forScope(request.workspaceId),
      // CUA 桌面自动化桥：agent settings cuaEnabled 总开关（默认 off）开启才注册 cua.* 工具；
      // 权限系统把鼠标/键盘类 cua 工具按 exec 风险逐次确认
      cuaBridge: !request.background && agentSettings.cuaEnabled === true
        ? getCuaService().bridge()
        : undefined,
      // runTerminal 进程组跟踪：settle 后存活的 dev server 等收集为长驻服务（右栏「服务」）
      servicesBridge: getAgentServicesRegistry()?.bridge(),
      // 自动审批闸：命令前缀规则命中 allow 直接放行；「帮我核准」开启时先由会话生效
      // 模型安全审查（completeOnce 直连供应商，不经工具循环，不会递归触发审批），
      // 未放行/审查失败/超时一律回落人工审批。两特性都未启用时不注入（零开销）
      approvalGate:
        agentSettings.approvalRules.length > 0 || agentSettings.approvalReviewer === "assistant"
          ? buildApprovalGate({
              rules: agentSettings.approvalRules,
              reviewer: agentSettings.approvalReviewer,
              providerId: providerId ?? undefined,
              modelId: modelId ?? undefined,
            })
          : undefined,
      // 会话文件快照：写/改文件前备份原文件、写入成功后备份改后副本（失败不阻塞写入）
      checkpointBridge: {
        backupFile: async (rel) => {
          try {
            const checkpoint = await backupWorkspaceFile(
              request.sessionId,
              workspaceRoot,
              rel,
              checkpointRun,
            );
            return checkpoint?.id ?? null;
          } catch (error) {
            console.warn("[checkpoints] 备份失败:", error);
            return null;
          }
        },
        afterFile: async (rel, checkpointId) => {
          if (!checkpointId) {
            return;
          }
          try {
            await backupAfterWrite(request.sessionId, workspaceRoot, rel, checkpointId);
          } catch (error) {
            console.warn("[checkpoints] 改后副本备份失败:", error);
          }
        },
      },
      // 网络搜索供应商 Key：密文读回，失败按无 key 处理
      webSearchApiKeys: await getWebSearchApiKeys().catch(() => ({})),
      // 模型历史持久化桥（SQLite）：run 内 append / 压缩 rewrite，存储失败只告警
      modelHistoryStore: {
        append: (messages) => {
          try {
            appendSessionModelHistory(request.sessionId, messages);
          } catch (error) {
            console.warn("[model-history] 追加失败:", error);
          }
        },
        rewrite: (history) => {
          try {
            rewriteSessionModelHistory(request.sessionId, history);
          } catch (error) {
            console.warn("[model-history] 重写失败:", error);
          }
        },
      },
      emit: emitTo,
    });
    sessions.set(request.sessionId, session);
    petSession = session;
    registerPetRun(request.sessionId, session, petRunId, request.display?.content ?? request.userMessage);
    await session.start(runUserMessage, request.history, sessionImages, modelHistory ?? undefined);
    // 不在此处 persist：暂停/等审批时 start 会提前返回，终态由 done/error 事件落库
    if (!phase.forcedMode && phaseDoneReason === "stop") {
      // 对话记忆自动摘要：正常结束后后台触发，失败只记 lastError，不影响返回与流
      scheduleAutoIngest(
        request.sessionId,
        request.workspaceId ?? phaseSession?.workspaceId ?? "",
      );
    }
    return { ok: true, text: collectedText, doneReason: phaseDoneReason };
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent run failed";
    // 走 emitTo 保证落库与飞书网关（done 清理/完成推送）与渲染层口径一致
    emitTo({ type: "error", sessionId: request.sessionId, message });
    emitTo({ type: "done", sessionId: request.sessionId, reason: "error" });
    return { ok: false, error: message };
  }
}

export interface LarkChatStartResult {
  ok: boolean;
  sessionId?: string;
  title?: string;
  error?: string;
  /** 失败原因分类：missing=会话不存在/已归档（可回退新建）；busy=会话正在运行 */
  reason?: "missing" | "busy";
}

/**
 * 飞书「对话」入口：按项目路径找到工作区（找不到则 createWorkspace），
 * 新建会话并异步运行 agent。立即返回（不等 run 结束），运行状态走「状态」查询、
 * 完成后由网关推送最终回复。
 * workspacePath 为 null 时在「公共区」新建会话（workspaceId "common" → workspace_id NULL），
 * agent 产物目录由 runAgentRequest 按无项目会话兜底（~/.zen/cache/sessions/<sessionId>）。
 */
export function startLarkChat(
  workspacePath: string | null,
  message: string,
  sessions: Map<string, AgentSession>,
): LarkChatStartResult {
  try {
    if (!message?.trim()) {
      return { ok: false, error: "invalid lark chat request" };
    }
    let workspaceId: string;
    let workspaceRoot: string;
    if (workspacePath) {
      const existing = listWorkspaceGroups().find(
        (group) => group.kind === "workspace" && group.path === workspacePath,
      );
      const workspace = existing ?? createWorkspace(workspacePath);
      workspaceId = workspace.id;
      workspaceRoot = workspacePath;
    } else {
      // 公共区会话：createSession 对 "common" 映射为 workspace_id NULL
      workspaceId = "common";
      workspaceRoot = "";
    }
    const session = createSession(workspaceId);
    const request: AgentRunRequest = {
      sessionId: session.id,
      workspaceId,
      // main 侧按 workspaceId 解析实际目录，不信任该字段（与渲染层口径一致）
      workspaceRoot,
      userMessage: message,
      history: [],
    };
    void runAgentRequest(request, { sessions }).catch((error) => {
      console.warn("[lark] 飞书会话运行失败:", error);
    });
    return { ok: true, sessionId: session.id, title: message.slice(0, 24) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 续聊历史取最近条数（含新消息走 runAgentRequest 的 userMessage） */
const LARK_CONTINUE_HISTORY_LIMIT = 40;

/** 从消息 meta.elementMarks 取可用标注（token + ref，防御式过滤无效条目） */
function elementMarksOf(message: ChatMessage): Array<{ token: string; ref: BrowserElementRef }> {
  const marks = message.meta?.elementMarks;
  if (!Array.isArray(marks)) {
    return [];
  }
  return marks.filter(
    (item): item is { token: string; ref: BrowserElementRef } =>
      Boolean(item) && typeof item.token === "string" && item.ref != null,
  );
}

/**
 * 飞书「继续」/续聊入口：向已有会话追加消息。历史从 workspace-db 读最近约 40 条
 * user/assistant 轮次；会话不存在或已归档 → reason="missing"（网关回退新建）；
 * 会话正在运行 → reason="busy"（不并发跑同一会话）。复用 startLarkChat 的异步启动模式。
 */
export function continueLarkChat(
  sessionId: string,
  message: string,
  sessions: Map<string, AgentSession>,
  send?: (event: AgentStreamEvent) => void,
  onFinished?: () => void,
): LarkChatStartResult {
  try {
    if (!message?.trim()) {
      return { ok: false, error: "invalid lark chat request" };
    }
    const record = loadSessionRecord(sessionId);
    if (!record || record.session.archived) {
      return { ok: false, error: "会话不存在或已归档", reason: "missing" };
    }
    const runState = sessions.get(sessionId)?.getRunState();
    if (
      runState &&
      (runState.runActive ||
        runState.waitingApproval ||
        runState.waitingAskCount > 0 ||
        runState.inserting)
    ) {
      return {
        ok: false,
        error: "会话正在运行，请等待完成或先回答问询",
        reason: "busy",
      };
    }
    // 历史里 user 消息的 `$el:` token 需展开为完整元素描述再喂给 Agent
    // （落库 content 保留原始 token，meta.elementMarks 里有对应 ref）
    const history: ChatTurn[] = record.messages
      .filter(
        (item): item is ChatMessage & { role: "user" | "assistant" } =>
          (item.role === "user" || item.role === "assistant") && item.content.trim().length > 0,
      )
      .slice(-LARK_CONTINUE_HISTORY_LIMIT)
      .map((item) => ({
        role: item.role,
        content:
          item.role === "user"
            ? expandElementTokens(item.content, elementMarksOf(item))
            : item.content,
      }));
    const request: AgentRunRequest = {
      sessionId,
      workspaceId: record.session.workspaceId ?? "common",
      workspaceRoot: "",
      userMessage: message,
      history,
    };
    void runAgentRequest(request, { sessions, send })
      .catch((error) => {
        console.warn("[zen] 续聊运行失败:", error);
      })
      .finally(onFinished);
    return { ok: true, sessionId, title: record.session.title };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

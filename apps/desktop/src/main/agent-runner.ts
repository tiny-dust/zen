import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { AgentSession, runMockAgent } from "@zen/agent-core";

import { withAttachmentManifest } from "./agent-attachments";
import { loadImageAttachments, isImagePath, withImageAnalysisText } from "./agent-images";
import { getAgentServicesRegistry } from "./agent-services";
import { buildApprovalGate } from "./approval-gate";
import { getCuaService } from "./abilities/cua";
import { getBrowserService } from "./browser/service";
import { resolveChatGptCredentials } from "./chatgpt-auth";
import { notifyLarkEvent } from "./lark/ipc";
import { appendMemoryNote, readMemorySnapshot, renderMemoryContext } from "./memory";
import { enabledMcpTools } from "./mcp-ipc";
import { inspectModelCapabilities } from "./model-capabilities";
import { getSelection, listProviders, loadProviderApiKey, isChatGptAuthProvider } from "./model-db";
import { resolvePromptText } from "./prompt-presets";
import { resolveWorkspaceDir } from "./sandbox";
import {
  backupAfterWrite,
  backupWorkspaceFile,
  beginTurnCheckpoint,
} from "./session-checkpoints";
import { getWebSearchApiKeys } from "./websearch-auth-store";
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
  rewriteSessionModelHistory,
  saveTaskList,
  setSessionMode,
} from "./workspace-db";
import { appendGoalDirective, appendSessionModeDirective, resolveRunSessionMode } from "./session-mode";

import type { AgentImageAttachment } from "@zen/agent-core";
import { expandElementTokens } from "@zen/tools-browser";
import type {
  AgentRunRequest,
  AgentStreamEvent,
  BrowserElementRef,
  ChatMessage,
  ChatTurn,
  SessionGoal,
  SessionMode,
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

export async function runAgentRequest(
  request: AgentRunRequest,
  options: RunAgentOptions,
): Promise<AgentRunResult> {
  const { sessions, send } = options;
  if (!request?.sessionId || !request.userMessage) {
    return { ok: false, error: "invalid agent run request" };
  }
  // 前置（查会话/落库/清旧 run）失败同样只走 {ok:false}：
  // 这里抛出会让 agent:run IPC reject，渲染层 send() 无兜底，运行态卡死
  // 会话模式：前置块解析（plan 批准消息先落库切回 interactive），后续 AgentSession 组装要用
  let runMode: SessionMode = "interactive";
  // 会话目标（Goals 目标模式）：active 时追加进系统提示词（同会话模式指令的注入点）
  let runGoal: SessionGoal | null = null;
  try {
    // 会话由 session:create 建立；不存在直接拒绝，避免 FK 落库失败
    const record = loadSessionRecord(request.sessionId);
    if (!record) {
      return { ok: false, error: "session not found" };
    }
    runMode = resolveRunSessionMode(
      record.session.mode,
      request,
      (mode) => setSessionMode(request.sessionId, mode),
    );
    runGoal = record.session.goal ?? null;

    // 首条消息把「新会话」改成摘要标题；用户消息与附件先行持久化
    ensureSessionTitle(request.sessionId, request.userMessage.slice(0, 24));
    // 落库优先用展示版（原始正文 + meta.elementMarks 等）：userMessage 是给 Agent 的展开文本，
    // 直接落库会让切会话/重启后恢复的气泡丢失元素 tag
    const userMeta: Record<string, unknown> = {
      ...(request.attachments?.length ? { attachments: request.attachments } : {}),
      ...(request.display?.meta ?? {}),
    };
    appendMessage(request.sessionId, {
      id: randomUUID(),
      role: "user",
      content: request.display?.content ?? request.userMessage,
      createdAt: Date.now(),
      meta: Object.keys(userMeta).length ? userMeta : undefined,
    });

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
  const emitTo = (streamEvent: AgentStreamEvent) => {
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
    if (streamEvent.sessionId !== request.sessionId) {
      send?.(streamEvent);
      return;
    }
    if (streamEvent.type === "tasks_updated") {
      // 任务清单只进 task_lists 表（悬浮面板恢复用）；不再写入消息流
      saveTaskList(request.sessionId, streamEvent.version, streamEvent.items);
    } else if (
      streamEvent.type === "insert_started" ||
      streamEvent.type === "original_resumed"
    ) {
      // 插入执行边界：上一段助手输出落库，此后事件归入新的一段
      rotateAcc();
    } else if (streamEvent.type !== "reference_found") {
      applyStreamToMessage(accMessage, streamEvent);
    }
    // 持久化绑定 done：暂停/等审批不是 run 终点，resume 后继续写同一条
    if (streamEvent.type === "done") {
      persistRun();
    }
    send?.(streamEvent);
  };

  try {
    const selection = await getSelection();
    const providerId = request.providerId || selection.providerId;
    const modelId = request.model || selection.modelId;
    const provider = (await listProviders()).find((item) => item.id === providerId);

    if (!provider || !modelId) {
      const controller = new AbortController();
      await runMockAgent(request.sessionId, request.userMessage, controller.signal, emitTo);
      // mock 始终发 done；此处兜底防止遗漏
      persistRun();
      return { ok: true };
    }

    const capabilities = inspectModelCapabilities(modelId);
    // 模型级对话端点覆盖优先（如 Responses-only 的 gpt-6 系列），否则沿用供应商协议
    const protocol =
      capabilities.chatEndpoint && capabilities.chatEndpoint !== "auto"
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

    // ChatGPT 账号登录：access_token 走 apiKey 通道（Bearer），附带后端识别头；
    // 其余供应商走静态 API Key
    let apiKey: string;
    let authHeaders: Record<string, string> | undefined;
    if (isChatGptAuthProvider(provider)) {
      const credentials = await resolveChatGptCredentials(provider.id);
      apiKey = credentials.accessToken;
      authHeaders = { originator: "zen_desktop" };
      if (credentials.accountId) {
        authHeaders["chatgpt-account-id"] = credentials.accountId;
      }
    } else {
      apiKey = await loadProviderApiKey(provider.id);
    }

    // agent 域配置：权限模式、提示词、技能路径；工作区按沙箱模式解析实际目录
    const agentSettings = await loadAgentSettings();
    const projectPath = getWorkspace(request.workspaceId)?.path;
    let workspaceRoot: string;
    if (projectPath) {
      workspaceRoot = (await resolveWorkspaceDir(projectPath, agentSettings.sandboxMode)).dir;
    } else {
      // 无项目会话（公共区）：Agent 产物落 ~/.zen/cache/sessions/<sessionId>，
      // 不再落到用户主目录/应用启动 cwd；mkdir 保证目录先于首次写文件存在
      workspaceRoot = sessionCacheDir(request.sessionId);
      await mkdir(workspaceRoot, { recursive: true });
    }

    // 技能与 MCP 惰性汇总（失败不阻塞会话）
    const [skills, mcpTools] = await Promise.all([
      import("@zen/skills")
        .then(({ listSkills }) => listSkills(agentSettings.skillExtraPaths))
        .then((items) =>
          items.map((item) => ({ id: item.id, name: item.name, description: item.description })),
        )
        .catch(() => []),
      enabledMcpTools().catch(() => []),
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

    const session = new AgentSession({
      sessionId: request.sessionId,
      workspaceRoot,
      protocol,
      baseUrl: provider.baseUrl,
      apiKey,
      model: modelId,
      // 已知上下文窗口下发给 agent-core：run 内步间按真实 usage 主动压缩；未知则不主动压缩
      contextWindow: capabilities.contextWindow,
      reasoningEffort: request.reasoningEffort,
      reasoning: capabilities.reasoning === true,
      authHeaders,
      permissionMode: agentSettings.permissionMode,
      // 会话模式指令追加在基础提示词之后（interactive 不追加，保持现状）；
      // 目标指令再追加在其后（仅 active 目标注入，预算不进提示词）
      systemPrompt: appendGoalDirective(
        appendSessionModeDirective(
          resolvePromptText(agentSettings),
          runMode,
          agentSettings.permissionMode,
        ),
        runGoal,
      ),
      // 设备环境 + 用户习惯记忆：注入系统提示词，避免每次重复探测路径/命令
      memoryContext: await readMemorySnapshot()
        .then(renderMemoryContext)
        .catch(() => undefined),
      memoryBridge: {
        appendNote: async (scope, text) => {
          await appendMemoryNote(scope, text);
          return { ok: true };
        },
      },
      multiAgent: true,
      skills,
      skillExtraPaths: agentSettings.skillExtraPaths,
      mcpTools,
      browserBridge: getBrowserService(),
      // CUA 桌面自动化桥：agent settings cuaEnabled 总开关（默认 off）开启才注册 cua.* 工具；
      // 权限系统把鼠标/键盘类 cua 工具按 exec 风险逐次确认
      cuaBridge: agentSettings.cuaEnabled === true ? getCuaService().bridge() : undefined,
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
    await session.start(runUserMessage, request.history, sessionImages, modelHistory ?? undefined);
    // 不在此处 persist：暂停/等审批时 start 会提前返回，终态由 done/error 事件落库
    return { ok: true };
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
    void runAgentRequest(request, { sessions }).catch((error) => {
      console.warn("[lark] 飞书续聊运行失败:", error);
    });
    return { ok: true, sessionId, title: record.session.title };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

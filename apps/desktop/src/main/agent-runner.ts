import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { AgentSession, runMockAgent } from "@zen/agent-core";

import { loadImageAttachments, isImagePath, withImageAnalysisText } from "./agent-images";
import { getBrowserService } from "./browser/service";
import { notifyLarkEvent } from "./lark/ipc";
import { appendMemoryNote, readMemorySnapshot, renderMemoryContext } from "./memory";
import { enabledMcpTools } from "./mcp-ipc";
import { inspectModelCapabilities } from "./model-capabilities";
import { getSelection, listProviders, loadProviderApiKey } from "./model-db";
import { resolvePromptText } from "./prompt-presets";
import { resolveWorkspaceDir } from "./sandbox";
import { loadAgentSettings, sessionCacheDir } from "./zen-dir";
import {
  appendMessage,
  createSession,
  createWorkspace,
  ensureSessionTitle,
  getSession as loadSessionRecord,
  getWorkspace,
  listWorkspaceGroups,
  saveTaskList,
} from "./workspace-db";

import type { AgentImageAttachment } from "@zen/agent-core";
import type { AgentRunRequest, AgentStreamEvent, ChatMessage } from "@zen/shared";
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
  appendMessage(sessionId, {
    id: message.id,
    role: "assistant",
    content: message.content,
    reasoning: message.reasoning || undefined,
    reasoningMs: message.reasoningMs,
    parts,
    meta: run ? { ...message.meta, run } : message.meta,
    createdAt: message.createdAt,
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
  // 会话由 session:create 建立；不存在直接拒绝，避免 FK 落库失败
  if (!loadSessionRecord(request.sessionId)) {
    return { ok: false, error: "session not found" };
  }

  // 首条消息把「新会话」改成摘要标题；用户消息与附件先行持久化
  ensureSessionTitle(request.sessionId, request.userMessage.slice(0, 24));
  appendMessage(request.sessionId, {
    id: randomUUID(),
    role: "user",
    content: request.userMessage,
    createdAt: Date.now(),
    meta: request.attachments?.length ? { attachments: request.attachments } : undefined,
  });

  await sessions.get(request.sessionId)?.cancel();
  sessions.delete(request.sessionId);

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

    // 附件图片路由：视觉模型 → 原生多模态 part；非视觉模型 → 视觉兜底预分析
    let runUserMessage = request.userMessage;
    let sessionImages: AgentImageAttachment[] | undefined;
    const imageRefs = (request.attachments ?? []).filter((att) =>
      isImagePath(att.path || att.name),
    );
    if (imageRefs.length) {
      if (inspectModelCapabilities(modelId).vision === true) {
        sessionImages = await loadImageAttachments(imageRefs);
      } else {
        runUserMessage = await withImageAnalysisText(request.userMessage, imageRefs, {
          providerId: provider.id,
          modelId,
        });
      }
    }

    const apiKey = await loadProviderApiKey(provider.id);

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

    const session = new AgentSession({
      sessionId: request.sessionId,
      workspaceRoot,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey,
      model: modelId,
      reasoningEffort: request.reasoningEffort,
      permissionMode: agentSettings.permissionMode,
      systemPrompt: resolvePromptText(agentSettings),
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
      emit: emitTo,
    });
    sessions.set(request.sessionId, session);
    await session.start(runUserMessage, request.history, sessionImages);
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
}

/**
 * 飞书「对话」入口：按项目路径找到工作区（找不到则 createWorkspace），
 * 新建会话并异步运行 agent。立即返回（不等 run 结束），运行状态走「状态」查询、
 * 完成后由网关推送最终回复。
 */
export function startLarkChat(
  workspacePath: string,
  message: string,
  sessions: Map<string, AgentSession>,
): LarkChatStartResult {
  try {
    if (!workspacePath || !message?.trim()) {
      return { ok: false, error: "invalid lark chat request" };
    }
    const existing = listWorkspaceGroups().find(
      (group) => group.kind === "workspace" && group.path === workspacePath,
    );
    const workspace = existing ?? createWorkspace(workspacePath);
    const session = createSession(workspace.id);
    const request: AgentRunRequest = {
      sessionId: session.id,
      workspaceId: workspace.id,
      // main 侧按 workspaceId 解析实际目录，不信任该字段（与渲染层口径一致）
      workspaceRoot: workspacePath,
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

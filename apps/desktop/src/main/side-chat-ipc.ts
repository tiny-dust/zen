import { randomUUID } from "node:crypto";

import { ipcMain } from "electron";

import type { AgentSession } from "@zen/agent-core";
import type {
  ChatTurn,
  SideChatListResult,
  SideChatMessage,
  SideChatModelRef,
  SideChatRecord,
  SideChatStreamEvent,
} from "@zen/shared";

import { runAgentRequest } from "./agent-runner";
import {
  MAX_SIDE_CHAT_MESSAGES,
  MAX_SIDE_CHAT_TEXT,
  createSideChat,
  getSideChat,
  listSideChats,
  removeSideChat,
  setSideChatModel,
  writeSideChat,
} from "./side-chats";
import {
  createSession,
  deleteSideChatSessions,
  findSideChatSession,
  getSession as loadSessionRecord,
  getWorkspace,
  renameSession,
  setSessionSideChatOf,
} from "./workspace-db";

/**
 * 侧边对话 IPC + 续写编排。
 * - 每条侧聊有一个「隐藏会话」（chat_sessions.side_chat_of 指向侧聊 id），续写走同一套
 *   agent 执行链，但消息落在隐藏会话里，主会话的消息表/状态完全不动；
 * - 隐藏会话不进侧栏分组与搜索（见 workspace-db.listWorkspaceGroups / searchSessions）；
 * - run 结束把 user/assistant 两条消息写回 side_chats（关标签/重启不丢），流事件走广播。
 */

export type SideChatStreamBroadcast = (event: SideChatStreamEvent) => void;

export interface SideChatIpcDeps {
  /** 与 agent:run 共用的 AgentSession 登记表（取消/清理走同一套） */
  sessions: Map<string, AgentSession>;
  /** side-chat:stream 广播（主进程 → 所有窗口） */
  broadcast: SideChatStreamBroadcast;
  /** 可注入的 run 驱动：单测替换成 mock，生产用 agent-runner 的实现 */
  runAgent?: typeof runAgentRequest;
}

export interface SideChatHandlers {
  list(sessionId: unknown): SideChatListResult;
  create(sessionId: unknown): SideChatRecord;
  save(record: unknown): { ok: boolean; error?: string };
  remove(id: unknown): { ok: boolean; error?: string };
  setModel(id: unknown, model: unknown, effort: unknown): { ok: boolean; error?: string };
  send(id: unknown, text: unknown): { ok: boolean; error?: string };
  stop(id: unknown): Promise<{ ok: boolean; error?: string }>;
}

/** 一条侧聊正在跑的续写：同一侧聊同时只允许一个 run */
interface SideChatRun {
  hiddenSessionId: string;
  /** stop() 置位：本轮收尾时不再广播 done/error（已广播 stopped） */
  stopped: boolean;
  promise: Promise<void>;
}

const runs = new Map<string, SideChatRun>();
/** 进程退出清理用：registerSideChatIpc / createSideChatHandlers 传入的登记表 */
let activeSessions: Map<string, AgentSession> | null = null;

/** 进程退出：取消在跑的侧聊并清空登记表（重启后残留登记直接丢弃，记录本身保留） */
export function shutdownSideChatRuns(): void {
  for (const run of runs.values()) {
    run.stopped = true;
    const session = activeSessions?.get(run.hiddenSessionId);
    if (session) {
      void session.cancel().catch(() => undefined);
      activeSessions?.delete(run.hiddenSessionId);
    }
  }
  runs.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** id 校验：非空字符串、长度有界 */
function parseId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : null;
}

/** model 校验：null = 跟随默认模型；undefined 返回 = 非法 */
function parseModelRef(value: unknown): SideChatModelRef | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const providerId = typeof value.providerId === "string" ? value.providerId.trim() : "";
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  if (!providerId || !modelId || providerId.length > 200 || modelId.length > 200) {
    return undefined;
  }
  return { providerId, modelId };
}

/** effort 校验：null = 不指定；undefined 返回 = 非法 */
function parseEffort(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length > 40) {
    return undefined;
  }
  return value.trim() || null;
}

/** 消息数组校验（save 入参）；条数超限或结构非法一律拒绝 */
function parseRecordsMessages(value: unknown): SideChatMessage[] | null {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_SIDE_CHAT_MESSAGES) {
    return null;
  }
  const messages: SideChatMessage[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const role = item.role === "user" || item.role === "assistant" ? item.role : null;
    if (!role || typeof item.text !== "string" || item.text.length > MAX_SIDE_CHAT_TEXT) {
      return null;
    }
    const id = parseId(item.id) ?? randomUUID();
    const at =
      typeof item.at === "number" && Number.isFinite(item.at) ? Math.floor(item.at) : Date.now();
    const error =
      typeof item.error === "string" && item.error ? item.error.slice(0, 2000) : undefined;
    messages.push({ id, role, text: item.text, at, ...(error ? { error } : {}) });
  }
  return messages;
}

/** 历史轮次：展示消息 → ChatTurn；带 error 的失败轮次不进上下文 */
function buildHistory(messages: SideChatMessage[]): ChatTurn[] {
  const history: ChatTurn[] = [];
  for (const message of messages) {
    if (message.error || !message.text.trim()) {
      continue;
    }
    history.push({ role: message.role, content: message.text });
  }
  return history;
}

/** 取侧聊的隐藏会话：没有就新建一个并打上 side_chat_of 标记（侧栏看不到它） */
function resolveHiddenSession(record: SideChatRecord): string {
  const existing = findSideChatSession(record.id);
  if (existing) {
    return existing.id;
  }
  const created = createSession(record.workspaceId);
  renameSession(created.id, record.title);
  setSessionSideChatOf(created.id, record.id);
  return created.id;
}

/**
 * 跑一轮续写：正文增量实时广播 delta，结束后把 user + assistant 两条消息落库。
 * 不写主会话消息表；隐藏会话的模型历史/检查点由 agent-runner 按隐藏会话 id 处理。
 */
async function runSideChatTurn(
  deps: SideChatIpcDeps,
  run: SideChatRun,
  record: SideChatRecord,
  text: string,
): Promise<void> {
  const { sessions, broadcast } = deps;
  const runAgent = deps.runAgent ?? runAgentRequest;
  const assistant: SideChatMessage = {
    id: randomUUID(),
    role: "assistant",
    text: "",
    at: Date.now(),
  };
  let result: { ok: boolean; error?: string };
  try {
    result = await runAgent(
      {
        sessionId: run.hiddenSessionId,
        workspaceId: record.workspaceId,
        workspaceRoot: getWorkspace(record.workspaceId)?.path ?? "",
        userMessage: text,
        history: buildHistory(record.messages),
      },
      {
        sessions,
        send: (event) => {
          // 只关心本文增量：工具/思考/用量事件对侧聊无意义，直接忽略
          if (event.sessionId !== run.hiddenSessionId || event.type !== "delta") {
            return;
          }
          assistant.text += event.text;
          broadcast({ id: record.id, type: "delta", text: event.text });
        },
      },
    );
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  assistant.at = Date.now();
  // 用户主动停止不算错误轮次（取消导致的 ok:false 不写 error，界面不发错误气泡）
  if (!result.ok && result.error && !run.stopped) {
    assistant.error = result.error.slice(0, 2000);
  }

  // 重新读一次：运行期间草稿/模型可能被 setModel/save 改过，不能拿旧快照覆盖
  const fresh = getSideChat(record.id) ?? record;
  const userMessage: SideChatMessage = {
    id: randomUUID(),
    role: "user",
    text,
    at: Date.now(),
  };
  const messages = [...fresh.messages, userMessage, assistant].slice(-MAX_SIDE_CHAT_MESSAGES);
  writeSideChat({ ...fresh, messages, updatedAt: Date.now() });

  // 收掉隐藏会话的 AgentSession 登记（下一轮 runAgentRequest 会按需重建）
  sessions.delete(run.hiddenSessionId);

  if (run.stopped) {
    return;
  }
  if (!result.ok) {
    broadcast({ id: record.id, type: "error", error: result.error ?? "运行失败" });
    return;
  }
  broadcast({ id: record.id, type: "done", message: assistant });
}

export function createSideChatHandlers(deps: SideChatIpcDeps): SideChatHandlers {
  activeSessions = deps.sessions;

  return {
    list(sessionId) {
      const id = parseId(sessionId);
      // 非法/空入参按「没有侧聊」处理，不向渲染层抛
      return { chats: id ? listSideChats(id) : [] };
    },

    create(sessionId) {
      const id = parseId(sessionId);
      if (!id) {
        throw new Error("invalid session id");
      }
      const record = loadSessionRecord(id);
      if (!record) {
        throw new Error("session not found");
      }
      return createSideChat(id, record.session.workspaceId ?? "common");
    },

    save(record) {
      if (!isRecord(record)) {
        return { ok: false, error: "invalid record" };
      }
      const id = parseId(record.id);
      if (!id) {
        return { ok: false, error: "invalid id" };
      }
      const messages = parseRecordsMessages(record.messages);
      if (!messages) {
        return { ok: false, error: "invalid messages" };
      }
      const draft = typeof record.draft === "string" ? record.draft.slice(0, MAX_SIDE_CHAT_TEXT) : "";
      const model = parseModelRef(record.model);
      if (model === undefined) {
        return { ok: false, error: "invalid model" };
      }
      const effort = parseEffort(record.effort);
      if (effort === undefined) {
        return { ok: false, error: "invalid effort" };
      }
      // 只允许更新已存在的记录：渲染层凭空造 id 不会写入任何行
      const existing = getSideChat(id);
      if (!existing) {
        return { ok: false, error: "侧边对话不存在" };
      }
      const updatedAt =
        typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
          ? Math.floor(record.updatedAt)
          : Date.now();
      const written = writeSideChat({ ...existing, messages, draft, model, effort, updatedAt });
      return written ? { ok: true } : { ok: false, error: "侧边对话不存在" };
    },

    remove(id) {
      const chatId = parseId(id);
      if (!chatId) {
        return { ok: false, error: "invalid id" };
      }
      const run = runs.get(chatId);
      if (run && !run.stopped) {
        return { ok: false, error: "正在回答中" };
      }
      removeSideChat(chatId);
      deleteSideChatSessions(chatId);
      return { ok: true };
    },

    setModel(id, model, effort) {
      const chatId = parseId(id);
      if (!chatId) {
        return { ok: false, error: "invalid id" };
      }
      const modelRef = parseModelRef(model);
      if (modelRef === undefined) {
        return { ok: false, error: "invalid model" };
      }
      const effortValue = parseEffort(effort);
      if (effortValue === undefined) {
        return { ok: false, error: "invalid effort" };
      }
      return setSideChatModel(chatId, modelRef, effortValue)
        ? { ok: true }
        : { ok: false, error: "侧边对话不存在" };
    },

    send(id, text) {
      const chatId = parseId(id);
      if (!chatId) {
        return { ok: false, error: "invalid id" };
      }
      if (typeof text !== "string") {
        return { ok: false, error: "invalid text" };
      }
      const content = text.trim();
      if (!content) {
        return { ok: false, error: "内容为空" };
      }
      if (content.length > MAX_SIDE_CHAT_TEXT) {
        return { ok: false, error: `内容过长（上限 ${MAX_SIDE_CHAT_TEXT} 字）` };
      }
      const record = getSideChat(chatId);
      if (!record) {
        return { ok: false, error: "侧边对话不存在" };
      }
      if (runs.has(chatId)) {
        return { ok: false, error: "正在回答中" };
      }
      let hiddenSessionId: string;
      try {
        hiddenSessionId = resolveHiddenSession(record);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "无法创建会话",
        };
      }
      const run: SideChatRun = {
        hiddenSessionId,
        stopped: false,
        promise: Promise.resolve(),
      };
      // 先登记再启动：同一 tick 内的第二次 send 会命中「正在回答中」
      runs.set(chatId, run);
      run.promise = runSideChatTurn(deps, run, record, content)
        .catch(() => undefined)
        .finally(() => {
          if (runs.get(chatId) === run) {
            runs.delete(chatId);
          }
        });
      return { ok: true };
    },

    async stop(id) {
      const chatId = parseId(id);
      if (!chatId) {
        return { ok: false, error: "invalid id" };
      }
      const run = runs.get(chatId);
      if (!run || run.stopped) {
        return { ok: false, error: "没有正在进行的回答" };
      }
      run.stopped = true;
      // 与 agent:cancel 同一条取消路径：有 AgentSession 就 cancel + 摘登记
      const session = deps.sessions.get(run.hiddenSessionId);
      if (session) {
        await session.cancel();
        deps.sessions.delete(run.hiddenSessionId);
      }
      deps.broadcast({ id: chatId, type: "stopped" });
      // 等本轮落库完成，避免紧接着的 send 与收尾写入交错
      await run.promise.catch(() => undefined);
      return { ok: true };
    },
  };
}

export function registerSideChatIpc(deps: SideChatIpcDeps): void {
  const handlers = createSideChatHandlers(deps);
  ipcMain.handle("side-chat:list", (_event, sessionId: unknown) => handlers.list(sessionId));
  ipcMain.handle("side-chat:create", (_event, sessionId: unknown) => handlers.create(sessionId));
  ipcMain.handle("side-chat:save", (_event, record: unknown) => handlers.save(record));
  ipcMain.handle("side-chat:remove", (_event, id: unknown) => handlers.remove(id));
  ipcMain.handle("side-chat:set-model", (_event, id: unknown, model: unknown, effort: unknown) =>
    handlers.setModel(id, model, effort),
  );
  ipcMain.handle("side-chat:send", (_event, id: unknown, text: unknown) => handlers.send(id, text));
  ipcMain.handle("side-chat:stop", (_event, id: unknown) => handlers.stop(id));
}

import { ipcMain } from "electron";

import type {
  AgentSettings,
  AgentStreamEvent,
  LarkAuthSnapshot,
  LarkBridgeSettings,
  LarkLoginEvent,
  LarkProjectSummary,
  LarkSessionState,
  LarkSessionSummary,
  LarkStatus,
} from "@zen/shared";
import { DEFAULT_LARK_BRIDGE_SETTINGS } from "@zen/shared";

import { saveAgentSettings } from "../zen-dir";
import { getSession, listWorkspaceGroups } from "../workspace-db";
import { peekLarkAuthSnapshot, readLarkAuthSnapshot } from "./auth";
import { collectSessionSummaries, LarkGateway, mapRunStateToLarkState } from "./gateway";
import type { LarkChatStartResult, SessionRunState } from "./gateway";
import { cancelLarkLogin, shutdownLarkLogin, startLarkLogin } from "./login";

/**
 * 飞书桥接 IPC 装配：lark:status 查询、lark:changed 广播、设置联动启停、
 * agent 流事件（ask_user / ask_resolved / done）喂给网关。
 * 单例 gateway 由本模块创建；sessions Map 在 index.ts，经 deps 注入回调访问。
 */

let gateway: LarkGateway | null = null;
let broadcastFn: ((channel: string, payload: unknown) => void) | null = null;
let lastSettings: LarkBridgeSettings = { ...DEFAULT_LARK_BRIDGE_SETTINGS };
let sessionStateOf: (sessionId: string) => SessionRunState | null = () => null;

export interface LarkIpcDeps {
  /** 答案写回：遍历主进程 sessions Map 调 session.resolveAsk */
  resolveAsk: (askId: string, answer: string) => boolean;
  /** 会话运行状态快照（sessions Map 里没有 → 返回 null → 空闲） */
  sessionState?: (sessionId: string) => SessionRunState | null;
  /** 飞书「对话」命令：按项目路径找到/新建工作区，新建会话并异步运行 agent */
  startChat?: (workspacePath: string, message: string) => LarkChatStartResult;
}

function toLarkState(sessionId: string): LarkSessionState {
  return mapRunStateToLarkState(sessionStateOf(sessionId));
}

function collectSummaries(limit: number): LarkSessionSummary[] {
  return collectSessionSummaries(listWorkspaceGroups(), toLarkState, limit);
}

/** 「项目」指令数据源：工作区（含路径），最近活跃时间取其下会话的最新 updatedAt */
function listProjectSummaries(): LarkProjectSummary[] {
  return listWorkspaceGroups()
    .filter((group) => group.kind === "workspace" && group.path)
    .map((group) => ({
      id: group.id,
      name: group.name,
      path: group.path as string,
      lastActiveAt: group.sessions.reduce(
        (max, session) => Math.max(max, session.updatedAt),
        group.createdAt,
      ),
    }));
}

/** 飞书会话 done 后读取最终助手回复（完成推送摘要） */
function lastAssistantReply(sessionId: string): string | null {
  const record = getSession(sessionId);
  if (!record) {
    return null;
  }
  for (let i = record.messages.length - 1; i >= 0; i -= 1) {
    const message = record.messages[i];
    if (message && message.role === "assistant" && message.content.trim()) {
      return message.content;
    }
  }
  return null;
}

function toLarkStatus(auth: LarkAuthSnapshot): LarkStatus {
  const snap = gateway?.snapshot() ?? { state: "off" as const, gatewayError: null };
  return { auth, gateway: snap.state, gatewayError: snap.gatewayError, settings: lastSettings };
}

function broadcastLarkChanged(): void {
  // 广播用同步快照（auth 取缓存，不触发子进程）；lark:status 查询才做实时探测
  broadcastFn?.("lark:changed", toLarkStatus(peekLarkAuthSnapshot()));
}

export function registerLarkIpc(
  broadcast: (channel: string, payload: unknown) => void,
  deps: LarkIpcDeps = { resolveAsk: () => false },
): void {
  broadcastFn = broadcast;
  sessionStateOf = deps.sessionState ?? (() => null);
  gateway = new LarkGateway({
    listSessions: collectSummaries,
    resolveAsk: deps.resolveAsk,
    onStateChange: () => broadcastLarkChanged(),
    listProjects: listProjectSummaries,
    startChat: async (workspacePath, message) => {
      if (!deps.startChat) {
        return { ok: false, error: "未装配会话启动能力" };
      }
      const result = await deps.startChat(workspacePath, message);
      if (result.ok && result.sessionId) {
        gateway?.trackSession(result.sessionId, result.title ?? "Zen 会话");
      }
      return result;
    },
    finalAssistantReply: lastAssistantReply,
  });

  ipcMain.handle("lark:status", async (): Promise<LarkStatus> => {
    return toLarkStatus(await readLarkAuthSnapshot());
  });

  // 飞书登录：device flow 由 login.ts 编排，各阶段经 lark:login-event 推给渲染层
  const emitLoginEvent = (event: LarkLoginEvent): void => {
    broadcastFn?.("lark:login-event", event);
  };
  ipcMain.handle("lark:login", async () => {
    await startLarkLogin(emitLoginEvent);
  });
  ipcMain.handle("lark:login-cancel", () => {
    cancelLarkLogin(emitLoginEvent);
  });
}

/** agent 流事件喂给网关：ask_user 推送、ask_resolved 移除、done 清理 */
export function notifyLarkEvent(event: AgentStreamEvent): void {
  if (!gateway) {
    return;
  }
  if (event.type === "ask_user") {
    // emitTo 侧 sessionId 已统一为父会话；标题查工作区库，查不到用兜底文案
    const title = getSession(event.sessionId)?.session.title ?? "Zen 会话";
    gateway.pushAsk(event.question, event.sessionId, title);
    return;
  }
  if (event.type === "ask_resolved") {
    gateway.onAskResolved(event.askId);
    return;
  }
  if (event.type === "done") {
    gateway.onSessionDone(event.sessionId);
  }
}

/**
 * 设置联动：enabled 时拉起网关，否则停止。
 * 首次启用且未锁定 open_id 时，取当前登录用户 open_id 写回设置——
 * 值相同则跳过保存，避免与渲染层 updateSettings 写回互相触发形成死循环。
 */
export async function syncLarkGatewayWithSettings(settings: AgentSettings): Promise<void> {
  if (!gateway) {
    return;
  }
  const lark = settings.larkBridge;
  lastSettings = lark;
  if (lark.enabled && !lark.allowedOpenId) {
    const auth = await readLarkAuthSnapshot();
    if (auth.available && auth.userOpenId) {
      const next = await saveAgentSettings({
        larkBridge: { ...lark, allowedOpenId: auth.userOpenId },
      });
      lastSettings = next.larkBridge;
      // 渲染层设置态同步补全后的 larkBridge（与 agent-ipc 的广播口径一致）
      broadcastFn?.("agent:settings-changed", next);
    }
  }
  if (lastSettings.enabled) {
    void gateway.start(lastSettings);
  } else {
    gateway.stop();
  }
  broadcastLarkChanged();
}

/** will-quit 收尾：停掉事件网关、杀掉残留登录轮询进程并解除模块引用 */
export function shutdownLark(): void {
  shutdownLarkLogin();
  gateway?.stop();
  gateway = null;
  broadcastFn = null;
}

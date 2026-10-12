import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename } from "node:path";

import { ipcMain } from "electron";

import type {
  AgentSettings,
  AgentStreamEvent,
  LarkAuthSnapshot,
  LarkBridgeSettings,
  LarkLoginEvent,
  LarkProjectSummary,
  LarkQuickCommand,
  LarkSessionState,
  LarkSessionSummary,
  LarkStatus,
} from "@zen/shared";
import { DEFAULT_LARK_BRIDGE_SETTINGS } from "@zen/shared";

import { initZenDir, loadAgentSettings, saveAgentSettings, zenConfigFile, zenRoot } from "../zen-dir";
import { currentLocale, mainT } from "../i18n";
import { getSession, listWorkspaceGroups } from "../workspace-db";
import { invalidateLarkAuthCache, peekLarkAuthSnapshot, readLarkAuthSnapshot } from "./auth";
import { invalidateLarkCliPathCache, npmExecutionEnv, resolveLarkCliPath, resolveNpmPath } from "./cli";
import { collectSessionSummaries, LarkGateway, mapRunStateToLarkState } from "./gateway";
import type { LarkChatStartResult, SessionRunState } from "./gateway";
import { cancelLarkLogin, shutdownLarkLogin, startLarkLogin } from "./login";

/**
 * 飞书桥接 IPC 装配：lark:status 查询、lark:changed 广播、设置联动启停、
 * agent 流事件（ask_user / ask_resolved / done）喂给网关。
 * 单例 gateway 由本模块创建；sessions Map 在 index.ts，经 deps 注入回调访问。
 */

const execFileAsync = promisify(execFile);
const LARK_CLI_PACKAGE = "@larksuite/cli";
let installInFlight: Promise<{ ok: boolean; error?: string }> | null = null;

let gateway: LarkGateway | null = null;
let broadcastFn: ((channel: string, payload: unknown) => void) | null = null;
let lastSettings: LarkBridgeSettings = { ...DEFAULT_LARK_BRIDGE_SETTINGS };
let sessionStateOf: (sessionId: string) => SessionRunState | null = () => null;
let configWatcher: FSWatcher | null = null;
let configWatchTimer: NodeJS.Timeout | null = null;
/** 网关锁被其他实例占用时的接管重试定时器（持锁实例退出后自动接管） */
let lockRetryTimer: NodeJS.Timeout | null = null;

export interface LarkIpcDeps {
  /** 答案写回：遍历主进程 sessions Map 调 session.resolveAsk */
  resolveAsk: (askId: string, answer: string) => boolean;
  /** 会话运行状态快照（sessions Map 里没有 → 返回 null → 空闲） */
  sessionState?: (sessionId: string) => SessionRunState | null;
  /** 飞书「对话」命令：按项目路径找到/新建工作区，新建会话并异步运行 agent；路径为 null 时在公共区建会话 */
  startChat?: (workspacePath: string | null, message: string) => LarkChatStartResult;
  /** 飞书「继续」/续聊：向已有会话追加消息（历史从 workspace-db 读取） */
  continueChat?: (sessionId: string, message: string) => LarkChatStartResult;
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

/**
 * 跨实例设置同步：安装版与 dev 实例共享 ~/.zen/config.json，但各跑各的网关——
 * agent:settings-changed 只在进程内广播，A 实例关掉桥接不会停掉 B 实例的网关
 * （历史上「设置关不掉飞书桥接」即此因）。这里监听 config.json 变更（300ms 防抖）：
 * larkBridge 与本实例已应用状态不一致 → 重新同步网关并广播给渲染层；
 * 一致（本实例自己写的）→ 跳过，避免与 syncLarkGatewayWithSettings 互相触发死循环。
 */
function watchConfigForCrossInstanceSync(): void {
  configWatcher?.close();
  const fileName = basename(zenConfigFile());
  try {
    // 监听目录而非文件本身：config.json 可能被重建（rename），目录 watch 不丢事件
    configWatcher = watch(zenRoot(), (_event, name) => {
      if (name !== fileName) {
        return;
      }
      if (configWatchTimer) {
        clearTimeout(configWatchTimer);
      }
      configWatchTimer = setTimeout(() => {
        configWatchTimer = null;
        void (async () => {
          const fresh = await loadAgentSettings();
          if (JSON.stringify(fresh.larkBridge) === JSON.stringify(lastSettings)) {
            return;
          }
          await syncLarkGatewayWithSettings(fresh);
        })();
      }, 300);
    });
    configWatcher.on("error", () => {
      // 目录被删等异常：放弃监听（下次 registerLarkIpc 重建）
      configWatcher?.close();
      configWatcher = null;
    });
  } catch {
    // ~/.zen 尚未初始化（registerLarkIpc 先于 initZenDir 执行）：就绪后再挂监听
    configWatcher = null;
    void initZenDir()
      .then(() => watchConfigForCrossInstanceSync())
      .catch(() => undefined);
  }
}

/**
 * 网关锁接管重试：锁被其他实例占用时（lockBlocked），每 30s 重试 start——
 * 持锁实例退出后锁文件变为陈旧（bridge-lock 心跳判定），本实例自动接管；
 * 抢到锁或桥接被关闭即停表。start 本身幂等（ready 态直接返回）。
 */
function scheduleLockRetry(): void {
  if (lockRetryTimer) {
    return;
  }
  lockRetryTimer = setInterval(() => {
    if (!gateway || !lastSettings.enabled) {
      stopLockRetry();
      return;
    }
    void gateway
      .start({
        allowedOpenId: lastSettings.allowedOpenId,
        quickCommands: lastSettings.quickCommands ?? [],
      })
      .then(() => {
        if (!gateway?.snapshot().lockBlocked) {
          stopLockRetry();
        }
      })
      .catch(() => undefined);
  }, 30_000);
  lockRetryTimer.unref?.();
}

function stopLockRetry(): void {
  if (lockRetryTimer) {
    clearInterval(lockRetryTimer);
    lockRetryTimer = null;
  }
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
    saveQuickCommands: persistQuickCommands,
    startChat: async (workspacePath, message) => {
      if (!deps.startChat) {
        return { ok: false, error: mainT(await currentLocale(), "lark.ipc.noStartChat") };
      }
      const result = await deps.startChat(workspacePath, message);
      if (result.ok && result.sessionId) {
        const locale = await currentLocale();
        gateway?.trackSession(result.sessionId, result.title ?? mainT(locale, "lark.sessionFallback"));
      }
      return result;
    },
    continueChat: async (sessionId, message) => {
      if (!deps.continueChat) {
        return { ok: false, error: mainT(await currentLocale(), "lark.ipc.noContinueChat") };
      }
      const result = await deps.continueChat(sessionId, message);
      if (result.ok && result.sessionId) {
        const locale = await currentLocale();
        gateway?.trackSession(result.sessionId, result.title ?? mainT(locale, "lark.sessionFallback"));
      }
      return result;
    },
    finalAssistantReply: lastAssistantReply,
  });
  watchConfigForCrossInstanceSync();

  ipcMain.handle("lark:status", async (_event, refresh?: boolean): Promise<LarkStatus> => {
    if (refresh) {
      invalidateLarkCliPathCache();
      invalidateLarkAuthCache();
    }
    return toLarkStatus(await readLarkAuthSnapshot());
  });

  ipcMain.handle("lark:install-cli", async (): Promise<{ ok: boolean; error?: string }> => {
    if (installInFlight) {
      return installInFlight;
    }
    const locale = await currentLocale();
    const npmPath = resolveNpmPath();
    if (!npmPath) {
      return { ok: false, error: mainT(locale, "lark.ipc.npmNotFound") };
    }
    installInFlight = execFileAsync(npmPath, ["install", "--global", LARK_CLI_PACKAGE], {
      timeout: 120_000,
      windowsHide: true,
      shell: process.platform === "win32",
      env: npmExecutionEnv(npmPath),
      maxBuffer: 2 * 1024 * 1024,
    })
      .then(() => {
        invalidateLarkCliPathCache();
        invalidateLarkAuthCache();
        if (!resolveLarkCliPath()) {
          return { ok: false, error: mainT(locale, "lark.ipc.cliStillMissing") };
        }
        return { ok: true };
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, error: mainT(locale, "lark.ipc.installFailed", { detail }) };
      })
      .finally(() => {
        installInFlight = null;
      });
    return installInFlight;
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

  // 设置页「发送测试问询卡片」：验证卡片按钮回调链路（假 askId，写回回「该问询已失效」为预期）
  ipcMain.handle("lark:test-ask-card", async (): Promise<{ ok: boolean; error?: string }> => {
    return (
      gateway?.sendTestAskCard() ?? {
        ok: false,
        error: mainT(await currentLocale(), "lark.ipc.gatewayNotReady"),
      }
    );
  });
}

/**
 * 飞书内「添加/删除快捷命令」的落库实现：刷新读盘（跨实例防覆盖）→
 * 合并 quickCommands → 保存 → 广播设置变更（所有实例的网关实时拿到新清单；
 * agent:set-settings 广播不触发（不经过该 IPC），手动补一次）。
 */
async function persistQuickCommands(commands: LarkQuickCommand[]): Promise<void> {
  const fresh = await loadAgentSettings();
  const next = await saveAgentSettings({
    larkBridge: { ...fresh.larkBridge, quickCommands: commands },
  });
  lastSettings = next.larkBridge;
  broadcastFn?.("agent:settings-changed", next);
  broadcastLarkChanged();
}

/** agent 流事件喂给网关：ask_user 推送、ask_resolved 移除、done 清理 */
export function notifyLarkEvent(event: AgentStreamEvent): void {
  if (!gateway) {
    return;
  }
  if (event.type === "ask_user") {
    // emitTo 侧 sessionId 已统一为父会话；标题查工作区库，查不到传空串由网关按 locale 兜底
    const title = getSession(event.sessionId)?.session.title ?? "";
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
    void gateway
      .start({
        allowedOpenId: lastSettings.allowedOpenId,
        quickCommands: lastSettings.quickCommands ?? [],
      })
      .then(() => {
        // 锁被其他实例占用：挂 30s 重试，持锁实例退出后自动接管
        if (gateway?.snapshot().lockBlocked) {
          scheduleLockRetry();
        }
      })
      .catch(() => undefined);
  } else {
    gateway.stop();
    stopLockRetry();
  }
  broadcastLarkChanged();
}

/** will-quit 收尾：停掉事件网关、杀掉残留登录轮询进程并解除模块引用 */
export function shutdownLark(): void {
  shutdownLarkLogin();
  if (configWatchTimer) {
    clearTimeout(configWatchTimer);
    configWatchTimer = null;
  }
  configWatcher?.close();
  configWatcher = null;
  stopLockRetry();
  gateway?.stop();
  gateway = null;
  broadcastFn = null;
}

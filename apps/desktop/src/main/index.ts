import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { registerMcpRuntime } from "@zen/agent-core";
import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from "electron";

import { runAgentRequest, continueLarkChat, startLarkChat } from "./agent-runner";
import { getAgentServicesRegistry, initAgentServices, shutdownAgentServices } from "./agent-services";
import { registerAgentServicesIpc } from "./agent-services-ipc";
import { setupApplicationMenu } from "./app-menu";
import { registerAgentIpc } from "./agent-ipc";
import { registerGitIpc } from "./git-ipc";
import { registerShellIpc } from "./shell-ipc";
import {
  deleteTurnCheckpoints,
  listFileCheckpoints,
  listTurnCheckpoints,
  reapplyTurnCheckpoints,
  restoreFileCheckpoint,
  undoTurnCheckpoints,
} from "./session-checkpoints";
import { initUserState, registerUserIpc } from "./user-ipc";
import { registerUpdaterIpc } from "./updater";
import { registerModelIpc } from "./model-ipc";
import { registerSessionIpc } from "./session-ipc";
import { startGoalReminders, shutdownGoalReminders } from "./goal-reminders";
import { resolveWorkspaceDir } from "./sandbox";
import { resolveSessionWorktreeRoot } from "./session-worktree";
import { registerWorkspaceIpc } from "./workspace-ipc";
import { registerMcpIpc, shutdownMcp } from "./mcp-ipc";
import { registerSyncIpc } from "./config-sync";
import { registerBrowserIpc } from "./browser/ipc";
import {
  attachBrowserWindow,
  getBrowserService,
  hideAllBrowserViews,
  shutdownBrowserService,
} from "./browser/service";
import { registerCacheIpc } from "./cache-ipc";
import { registerFaviconIpc } from "./favicons";
import { registerSkillsMarketIpc } from "./skills-market";
import { registerTerminalIpc } from "./terminal/ipc";
import { shutdownTerminalService } from "./terminal/service";
import { startCliServer, stopCliServer } from "./cli-server";
import { recordErrorReport, registerErrorReportsIpc } from "./error-reports";
import { registerFeatureCatalogIpc } from "./feature-catalog";
import { initZenDir, loadAgentSettings, sessionCacheDir } from "./zen-dir";
import { initDeviceMemory } from "./memory";
import { registerMemoryIpc } from "./memory-ipc";
import { registerSchedulerIpc, shutdownScheduler } from "./scheduler-ipc";
import { registerLarkIpc, shutdownLark, syncLarkGatewayWithSettings } from "./lark/ipc";
import { registerWindowControlsIpc, registerTitleBarOverlayThemeSync, titleBarOverlayOptions } from "./window-controls";
import { registerSystemAbilitiesIpc, shutdownSystemAbilities } from "./abilities/ipc";
import { unregisterAllGlobalShortcuts } from "./global-shortcuts";
import { appendMessage, getSession, getWorkspace } from "./workspace-db";

import type { AgentSession } from "@zen/agent-core";
import type {
  AgentRunRequest,
  AgentStreamEvent,
  AskUserAnswer,
  ToolApprovalDecision,
} from "@zen/shared";

const sessions = new Map<string, AgentSession>();

const execFileAsync = promisify(execFile);

function emit(webContents: Electron.WebContents, event: AgentStreamEvent): void {
  if (!webContents.isDestroyed()) {
    webContents.send("agent:event", event);
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 880,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#181818",
    title: isDevRenderer ? "Zen Dev" : "Zen",
    titleBarStyle: "hidden",
    // 交通灯在 38px 标题栏内垂直居中（--titlebar-h / --titlebar-lead 与之一致）
    trafficLightPosition: { x: 12, y: 13 },
    // Windows/Linux：原生 titleBarOverlay 三键（系统自绘，点击不走渲染层拖拽区）。
    // 自绘三键在 Linux/Windows 会被后登记的 drag 矩形盖住导致点击被吞，故弃用。
    // 主题切换由 registerTitleBarOverlayThemeSync 重放配色。
    ...(process.platform !== "darwin" ? { titleBarOverlay: titleBarOverlayOptions() } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on("ready-to-show", () => {
    window.show();
  });

  // 整页刷新（Cmd/Ctrl+R、F5）会丢终端面板等渲染层状态：一律拦截。
  // dev 保留 CmdOrCtrl+Alt+R 手动重载（见 app-menu.ts），故带 Alt 的组合放行。
  window.webContents.on("before-input-event", (event, input) => {
    const key = (input.key || "").toLowerCase();
    const reloadCombo =
      (key === "r" && (input.control || input.meta) && !input.alt) ||
      (key === "f5" && !input.alt);
    if (reloadCombo) {
      event.preventDefault();
    }
  });

  // 锁定窗口标题（页面 <title> 会覆盖 BrowserWindow 的 title，dev/prod 需可区分）
  window.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  // 渲染进程异常退出时自动恢复，避免整窗黑屏
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") {
      // 先摘掉可能残留的 WebContentsView（全部工作区），再 reload
      shutdownBrowserService();
      window.webContents.reload();
      // 异常退出落异常中心（clean-exit 视为正常退出，不记录）
      void recordErrorReport(
        "main",
        "render-process-gone",
        `渲染进程异常退出: ${details.reason} (exitCode=${details.exitCode})`,
      ).catch(() => undefined);
    }
  });

  // 渲染层整页刷新/热更新后：隐藏并重建浏览器视图，避免旧 WebContentsView 盖在左上角。
  // 画中画悬浮时跳过：视图此时挂在悬浮窗上，不该被主窗口的刷新逻辑隐藏
  window.webContents.on("did-start-loading", () => {
    hideAllBrowserViews();
  });
  window.webContents.on("did-finish-load", () => {
    // 全部工作区服务重新指向主窗口（macOS 关窗后 activate 重建场景），保持隐藏，
    // 等各工作区面板重新 setBounds；画中画悬浮的除外，避免悬浮窗页面被连坐熄灭
    attachBrowserWindow(window);
    hideAllBrowserViews();
  });

  window.webContents.setWindowOpenHandler((details) => {
    const url = details.url || "";
    if (/^https?:\/\//i.test(url)) {
      // 网页一律进右侧浏览器面板，不拉起系统浏览器、也不导航主窗口
      void getBrowserService()
        .open(url)
        .catch(() => undefined);
      return { action: "deny" };
    }
    if (/^(mailto:|tel:)/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

function registerIpc(): void {
  ipcMain.handle("app:info", () => ({
    workspaceRoot: process.cwd(),
    version: app.getVersion(),
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  ipcMain.handle("git:info", async (_event, cwd?: string) => {
    const workdir = cwd || process.cwd();
    try {
      const [{ stdout: branch }, { stdout: toplevel }] = await Promise.all([
        execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workdir }),
        execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: workdir }),
      ]);
      return { repo: basename(toplevel.trim()), branch: branch.trim() };
    } catch {
      return { repo: "", branch: "" };
    }
  });

  // run 主体抽到 agent-runner.ts（渲染层入口：send 回传 webContents，行为不变）
  ipcMain.handle("agent:run", async (event, request: AgentRunRequest) =>
    runAgentRequest(request, {
      sessions,
      send: (streamEvent) => emit(event.sender, streamEvent),
    }),
  );

  ipcMain.handle("agent:cancel", async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "session not running" };
    }
    await session.cancel();
    sessions.delete(sessionId);
    return { ok: true };
  });

  ipcMain.handle("agent:pause", async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "session not running" };
    }
    await session.pause();
    return { ok: true };
  });

  ipcMain.handle("agent:resume", async (_event, sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "session not running" };
    }
    await session.resume();
    return { ok: true };
  });

  // 手动重试失败/取消的子 Agent（右栏 Agents 面板「重试」按钮）
  ipcMain.handle("agent:retry-sub-agent", async (_event, sessionId: string, agentId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "session not running" };
    }
    if (typeof agentId !== "string" || !agentId) {
      return { ok: false, error: "invalid agent id" };
    }
    return session.retrySubAgent(agentId)
      ? { ok: true }
      : { ok: false, error: "子 Agent 不存在或不在可重试状态" };
  });

  // 插入执行：打断当前 run（保留 checkpoint），插入消息以最高权重先执行，
  // 完成后原 run 从断点自动 resume。前置校验失败（等审批/提问/并发插入）直接拒绝，
  // 不落库用户消息；校验通过后落库插入消息并异步驱动 insert，错误经流事件透出。
  ipcMain.handle(
    "agent:insert",
    async (_event, sessionId: string, text: string) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { ok: false, error: "session not running" };
      }
      if (typeof text !== "string" || !text.trim()) {
        return { ok: false, error: "invalid insert request" };
      }
      const guard = session.canInsert();
      if (!guard.ok) {
        return guard;
      }
      appendMessage(sessionId, {
        id: randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now(),
        meta: { inserted: true },
      });
      void session.insert(text).catch(() => undefined);
      return { ok: true };
    },
  );

  // 运行中转向（steer）：打断当前 run（保留 checkpoint），新指示以最高权重先执行，
  // 完成后结合新方向自动恢复原任务；消息带 meta.steer 供气泡渲染「转向」标识。
  // 前置校验失败（等审批/提问/并发插入/无运行中 run）直接拒绝，不落库。
  ipcMain.handle("agent:steer", async (_event, sessionId: string, text: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "session not running" };
    }
    if (typeof text !== "string" || !text.trim()) {
      return { ok: false, error: "invalid steer request" };
    }
    const guard = session.canInsert();
    if (!guard.ok) {
      return guard;
    }
    appendMessage(sessionId, {
      id: randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
      meta: { steer: true },
    });
    void session.insert(text, { steer: true }).catch(() => undefined);
    return { ok: true };
  });

  ipcMain.handle(
    "agent:approval",
    async (_event, sessionId: string, decision: ToolApprovalDecision) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { ok: false, error: "session not running" };
      }
      if (!decision?.approvalId || typeof decision.approved !== "boolean") {
        return { ok: false, error: "invalid approval decision" };
      }
      await session.approve(decision);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "agent:ask-resolve",
    async (_event, sessionId: string, answer: AskUserAnswer) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { ok: false, error: "session not running" };
      }
      if (!answer?.askId || typeof answer.answer !== "string") {
        return { ok: false, error: "invalid ask answer" };
      }
      const resolved = session.resolveAsk(answer.askId, answer.answer);
      return resolved ? { ok: true } : { ok: false, error: "ask not found" };
    },
  );

  // 会话文件快照（检查点）：列出 / 恢复写改前备份的原文件
  ipcMain.handle("agent:checkpoints:list", (_event, sessionId: string) =>
    listFileCheckpoints(sessionId),
  );

  // 按轮（run）分组的改动摘要：每轮文件数与撤销状态，「文件快照」区分组展示
  ipcMain.handle("agent:checkpoints:list-turns", (_event, sessionId: string) =>
    listTurnCheckpoints(sessionId),
  );

  // 与 runAgentRequest 同口径：按会话归属工作区解析实际根目录（沙箱模式生效）
  async function checkpointWorkspaceRoot(sessionId: string): Promise<string | null> {
    const record = getSession(sessionId);
    if (!record) {
      return null;
    }
    const projectPath = getWorkspace(record.session.workspaceId)?.path;
    if (projectPath) {
      const worktreeRoot = await resolveSessionWorktreeRoot(sessionId, projectPath);
      if (worktreeRoot) {
        return worktreeRoot;
      }
      const agentSettings = await loadAgentSettings();
      return (await resolveWorkspaceDir(projectPath, agentSettings.sandboxMode)).dir;
    }
    return sessionCacheDir(sessionId);
  }

  ipcMain.handle(
    "agent:checkpoints:restore",
    async (_event, sessionId: string, checkpointId: string) => {
      const workspaceRoot = await checkpointWorkspaceRoot(sessionId);
      if (!workspaceRoot) {
        return { ok: false, error: "session not found" };
      }
      return restoreFileCheckpoint(sessionId, workspaceRoot, checkpointId);
    },
  );

  // 撤销一轮：恢复该轮所有改前副本（新建文件移除）；仅允许最新未撤销轮（防旧副本覆盖新改动）
  ipcMain.handle("agent:checkpoints:undo-turn", async (_event, sessionId: string, run: number) => {
    const workspaceRoot = await checkpointWorkspaceRoot(sessionId);
    if (!workspaceRoot) {
      return { ok: false, error: "session not found" };
    }
    return undoTurnCheckpoints(sessionId, workspaceRoot, run);
  });

  // 重新套用已撤销的一轮：恢复该轮所有改后副本
  ipcMain.handle(
    "agent:checkpoints:reapply-turn",
    async (_event, sessionId: string, run: number) => {
      const workspaceRoot = await checkpointWorkspaceRoot(sessionId);
      if (!workspaceRoot) {
        return { ok: false, error: "session not found" };
      }
      return reapplyTurnCheckpoints(sessionId, workspaceRoot, run);
    },
  );

  // 删除一轮快照（记录 + 备份文件）：只清磁盘占用，不动工作区文件
  ipcMain.handle("agent:checkpoints:delete-turn", (_event, sessionId: string, run: number) =>
    deleteTurnCheckpoints(sessionId, run),
  );

  // 飞书桥接：lark:status 查询 + 答案写回（遍历 sessions Map）/ 会话状态快照
  registerLarkIpc(broadcast, {
    resolveAsk: (askId, answer) => {
      for (const session of sessions.values()) {
        if (session.resolveAsk(askId, answer)) {
          return true;
        }
      }
      return false;
    },
    sessionState: (sessionId) => sessions.get(sessionId)?.getRunState() ?? null,
    // 「对话」命令：按项目路径找到/新建工作区 + 新建会话并异步运行 agent
    startChat: (workspacePath, message) => startLarkChat(workspacePath, message, sessions),
    // 「继续」/续聊：向已有会话追加消息
    continueChat: (sessionId, message) => continueLarkChat(sessionId, message, sessions),
  });
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

// 主进程兜底异常采集：uncaught/unhandled 落异常中心（~/.zen/error-reports.json），
// 保留 console.error 日志、不让进程退出；记录链路自身抛错就地吞掉，避免异常钩子死循环。
process.on("uncaughtException", (error: Error) => {
  console.error("[zen] uncaughtException:", error);
  try {
    void recordErrorReport(
      "main",
      "uncaught",
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
    ).catch(() => undefined);
  } catch {
    // 记录自身失败不再上抛
  }
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[zen] unhandledRejection:", reason);
  try {
    void recordErrorReport(
      "main",
      "unhandled",
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : undefined,
    ).catch(() => undefined);
  } catch {
    // 记录自身失败不再上抛
  }
});

// dev 与生产 app 名称区分（dev 为 Zen Dev），避免安装生产包时与开发包混淆
const isDevRenderer = Boolean(process.env.ELECTRON_RENDERER_URL);
app.setName(isDevRenderer ? "Zen Dev" : "Zen");
process.title = isDevRenderer ? "Zen Dev" : "Zen";
// 品牌名改了，但 userData 保持原路径，避免已有登录态/数据库/设置丢失
app.setPath("userData", join(app.getPath("appData"), "@zen/desktop"));

// macOS Dock 图标（dev 下 Electron 可执行文件名仍显示 Electron，需显式设置）。
// nativeImage 只支持 PNG/JPEG，不支持 icns：运行时用 build/icon.png，
// 打包后的 Dock 图标由 electron-builder 注入 build/icon.icns，无需运行时设置。
function applyDockBrand() {
  if (process.platform !== "darwin" || app.isPackaged) {
    return;
  }
  const iconPath = join(__dirname, "../../build/icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    console.warn("[zen] Dock 图标缺失：", iconPath);
    return;
  }
  try {
    app.dock?.setIcon(icon);
  } catch (error) {
    console.warn("[zen] Dock 图标设置失败：", error);
  }
}

app.whenReady().then(() => {
  applyDockBrand();
  registerIpc();
  // 启动即同步飞书桥接设置（enabled 时拉起事件网关；registerLarkIpc 已就绪）
  void loadAgentSettings().then((settings) => syncLarkGatewayWithSettings(settings));
  registerUserIpc();
  registerModelIpc();
  registerSessionIpc((sessionId) => sessions.has(sessionId));
  registerWorkspaceIpc();
  registerGitIpc();
  registerShellIpc();
  registerAgentIpc(broadcast);
  registerAgentServicesIpc(initAgentServices(broadcast));
  registerMcpIpc();
  registerCacheIpc();
  // 站点图标（浏览器历史 / 网络来源）：主进程抓取 + 缓存，渲染层只拿 data URL
  registerFaviconIpc();
  registerSkillsMarketIpc();
  // 异常中心：主/渲染层异常统一收集 + errors:* IPC（渲染层上报与异常中心面板）
  registerErrorReportsIpc(broadcast);
  registerSyncIpc();
  registerUpdaterIpc();
  registerBrowserIpc(broadcast);
  registerTerminalIpc(broadcast);
  registerMemoryIpc();
  // 系统能力四件套：语音输入 / TTS / OCR / CUA（probe 驱动 UI 显隐，平台不支持自动隐藏）
  registerSystemAbilitiesIpc();
  // 定时任务：IPC + 每分钟调度循环（含启动补跑错过的 daily 任务）
  registerSchedulerIpc(broadcast, sessions);
  registerWindowControlsIpc();
  registerTitleBarOverlayThemeSync();
  // 可选功能目录：feature:list 返回目录 + probe 结果
  registerFeatureCatalogIpc();
  // zen CLI：本地 TCP 服务（127.0.0.1 随机端口 + token 写 ~/.zen/cli-socket.json）
  startCliServer(broadcast, sessions);
  // 应用菜单：去掉 Reload 角色（禁用整页刷新），保留复制粘贴等系统快捷键角色
  setupApplicationMenu(isDevRenderer);
  createWindow();
  startGoalReminders({
    isSessionRunning: (sessionId) => sessions.has(sessionId),
    openSession: (sessionId) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed()) ?? createWindow();
      window.show();
      window.focus();
      const sendOpenRequest = () => window.webContents.send("session:open-request", sessionId);
      if (window.webContents.isLoading()) {
        window.webContents.once("did-finish-load", sendOpenRequest);
      } else {
        sendOpenRequest();
      }
    },
  });
  // ~/.zen 初始化 + agent-core 的 MCP 调用运行时（callMcpTool 在 mcp-ipc 内）
  void initZenDir().then(() => registerMcpRuntime(() => import("./mcp-ipc")));
  // 旧 safeStorage 凭据就地升级为 aes:v1（更新后不再丢密钥/掉登录）；auth token 迁移在 loadStoredAuth 内
  void import("./model-db").then(({ migrateProviderSecrets }) => migrateProviderSecrets());
  // 记忆：~/.zen/memory 缺设备快照时自动采集（PATH 工具扫描），失败不阻塞启动
  void initDeviceMemory();
  void initUserState();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error: unknown) => {
  // 启动链路任一环节失败必须可见：否则进程存活但永远不建窗口，用户只看到"点开没反应"。
  console.error("[zen] 启动失败:", error);
  dialog.showErrorBox(
    "Zen 启动失败",
    error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error),
  );
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  shutdownMcp();
  shutdownTerminalService();
  shutdownBrowserService();
  shutdownSystemAbilities();
  shutdownLark();
  shutdownScheduler();
  shutdownGoalReminders();
  unregisterAllGlobalShortcuts();
  void stopCliServer().catch((error) => {
    console.warn("[zen] CLI 服务清理失败:", error);
  });
  void shutdownAgentServices().catch((error) => {
    console.warn("[zen] 长驻服务清理失败:", error);
  });
});

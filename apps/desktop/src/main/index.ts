import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { registerMcpRuntime } from "@zen/agent-core";
import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from "electron";

import { runAgentRequest, startLarkChat } from "./agent-runner";
import { getAgentServicesRegistry, initAgentServices, shutdownAgentServices } from "./agent-services";
import { registerAgentServicesIpc } from "./agent-services-ipc";
import { registerAgentIpc } from "./agent-ipc";
import { registerGitIpc } from "./git-ipc";
import { registerShellIpc } from "./shell-ipc";
import { initUserState, registerUserIpc } from "./user-ipc";
import { registerUpdaterIpc } from "./updater";
import { registerModelIpc } from "./model-ipc";
import { registerSessionIpc } from "./session-ipc";
import { registerWorkspaceIpc } from "./workspace-ipc";
import { registerMcpIpc, shutdownMcp } from "./mcp-ipc";
import { registerSyncIpc } from "./config-sync";
import { registerBrowserIpc } from "./browser/ipc";
import { getBrowserService, shutdownBrowserService } from "./browser/service";
import { registerCacheIpc } from "./cache-ipc";
import { registerSkillsMarketIpc } from "./skills-market";
import { registerTerminalIpc } from "./terminal/ipc";
import { shutdownTerminalService } from "./terminal/service";
import { initZenDir, loadAgentSettings } from "./zen-dir";
import { initDeviceMemory } from "./memory";
import { registerMemoryIpc } from "./memory-ipc";
import { registerLarkIpc, shutdownLark, syncLarkGatewayWithSettings } from "./lark/ipc";
import { registerWindowControlsIpc } from "./window-controls";
import { appendMessage } from "./workspace-db";

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
    // Windows：原生 caption 按钮叠加（Win11 观感 + Snap Layouts）。初始配色与
    // styles.css 的 --color-bg / --color-topbar-icon（dark，同 backgroundColor）
    // 一致，渲染层挂载后按 token 实际值再同步（window:set-titlebar-overlay）。
    // macOS 不传（红绿灯原样）；Linux 叠加观感不可控，走渲染层自绘三键。
    ...(process.platform === "win32"
      ? {
          titleBarOverlay: { color: "#181818", symbolColor: "#f4f4f5", height: 38 },
        }
      : {}),
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

  // 锁定窗口标题（页面 <title> 会覆盖 BrowserWindow 的 title，dev/prod 需可区分）
  window.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  // 渲染进程异常退出时自动恢复，避免整窗黑屏
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") {
      // 先摘掉可能残留的 WebContentsView，再 reload
      shutdownBrowserService();
      window.webContents.reload();
    }
  });

  // 渲染层整页刷新/热更新后：隐藏并重建浏览器视图，避免旧 WebContentsView 盖在左上角。
  // 画中画悬浮时跳过：视图此时挂在悬浮窗上，不该被主窗口的刷新逻辑隐藏
  window.webContents.on("did-start-loading", () => {
    const service = getBrowserService();
    if (!service.isPipFloating()) {
      service.setVisible(false);
    }
  });
  window.webContents.on("did-finish-load", () => {
    const service = getBrowserService();
    service.attachToWindow(window);
    // 不自动 dispose（保留会话），但默认不可见，等 UI 再 setBounds；
    // 画中画悬浮时同样跳过隐藏，避免悬浮窗页面被主窗口刷新连坐熄灭
    if (!service.isPipFloating()) {
      service.setVisible(false);
    }
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
  });
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

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
  registerSessionIpc();
  registerWorkspaceIpc();
  registerGitIpc();
  registerShellIpc();
  registerAgentIpc(broadcast);
  registerAgentServicesIpc(initAgentServices(broadcast));
  registerMcpIpc();
  registerCacheIpc();
  registerSkillsMarketIpc();
  registerSyncIpc();
  registerUpdaterIpc();
  registerBrowserIpc(broadcast);
  registerTerminalIpc(broadcast);
  registerMemoryIpc();
  registerWindowControlsIpc();
  createWindow();
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
  shutdownLark();
  void shutdownAgentServices().catch((error) => {
    console.warn("[zen] 长驻服务清理失败:", error);
  });
});

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

import { AgentSession, registerMcpRuntime, runMockAgent } from "@zen/agent-core";
import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from "electron";

import { getSelection, listProviders, loadProviderApiKey } from "./model-db";
import { getWorkspace } from "./workspace-db";
import {
  appendMessage,
  ensureSessionTitle,
  getSession as loadSessionRecord,
  saveTaskList,
} from "./workspace-db";
import { registerAgentIpc } from "./agent-ipc";
import { registerGitIpc } from "./git-ipc";
import { registerShellIpc } from "./shell-ipc";
import { initUserState, registerUserIpc } from "./user-ipc";
import { registerUpdaterIpc } from "./updater";
import { registerModelIpc } from "./model-ipc";
import { registerSessionIpc } from "./session-ipc";
import { registerWorkspaceIpc } from "./workspace-ipc";
import { registerMcpIpc, enabledMcpTools, shutdownMcp } from "./mcp-ipc";
import { registerSyncIpc } from "./config-sync";
import { registerBrowserIpc } from "./browser/ipc";
import { getBrowserService, shutdownBrowserService } from "./browser/service";
import { registerCacheIpc } from "./cache-ipc";
import { registerSkillsMarketIpc } from "./skills-market";
import { registerTerminalIpc } from "./terminal/ipc";
import { shutdownTerminalService } from "./terminal/service";
import { resolvePromptText } from "./prompt-presets";
import { resolveWorkspaceDir } from "./sandbox";
import { initZenDir, loadAgentSettings } from "./zen-dir";

import type {
  AgentRunRequest,
  AgentStreamEvent,
  AskUserAnswer,
  ChatMessage,
  ToolApprovalDecision,
} from "@zen/shared";
import { applyStreamToMessage, getMessageRun, shouldPersistAssistantMessage } from "@zen/shared";

const sessions = new Map<string, AgentSession>();

const execFileAsync = promisify(execFile);

function emit(webContents: Electron.WebContents, event: AgentStreamEvent): void {
  if (!webContents.isDestroyed()) {
    webContents.send("agent:event", event);
  }
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

  // 渲染层整页刷新/热更新后：隐藏并重建浏览器视图，避免旧 WebContentsView 盖在左上角
  window.webContents.on("did-start-loading", () => {
    getBrowserService().setVisible(false);
  });
  window.webContents.on("did-finish-load", () => {
    const service = getBrowserService();
    service.attachToWindow(window);
    // 不自动 dispose（保留会话），但默认不可见，等 UI 再 setBounds
    service.setVisible(false);
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

  ipcMain.handle("agent:run", async (event, request: AgentRunRequest) => {
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

    // 流式累积助手回复：与 UI 共用 applyStreamToMessage；仅 done/明确错误终态落库
    const accMessage: ChatMessage = {
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
    const emitTo = (streamEvent: AgentStreamEvent) => {
      if (streamEvent.sessionId !== request.sessionId) {
        emit(event.sender, streamEvent);
        return;
      }
      if (streamEvent.type === "tasks_updated") {
        // 任务清单只进 task_lists 表（悬浮面板恢复用）；不再写入消息流
        saveTaskList(request.sessionId, streamEvent.version, streamEvent.items);
      } else if (streamEvent.type !== "reference_found") {
        applyStreamToMessage(accMessage, streamEvent);
      }
      // 持久化绑定 done：暂停/等审批不是 run 终点，resume 后继续写同一条
      if (streamEvent.type === "done") {
        persistRun();
      }
      emit(event.sender, streamEvent);
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

      const apiKey = await loadProviderApiKey(provider.id);

      // agent 域配置：权限模式、提示词、技能路径；工作区按沙箱模式解析实际目录
      const agentSettings = await loadAgentSettings();
      const projectPath = getWorkspace(request.workspaceId)?.path;
      const { dir: workspaceRoot } = projectPath
        ? await resolveWorkspaceDir(projectPath, agentSettings.sandboxMode)
        : { dir: homedir() };

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
        multiAgent: true,
        skills,
        skillExtraPaths: agentSettings.skillExtraPaths,
        mcpTools,
        browserBridge: getBrowserService(),
        emit: emitTo,
      });
      sessions.set(request.sessionId, session);
      await session.start(request.userMessage, request.history);
      // 不在此处 persist：暂停/等审批时 start 会提前返回，终态由 done/error 事件落库
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "agent run failed";
      applyStreamToMessage(accMessage, { type: "error", sessionId: request.sessionId, message });
      applyStreamToMessage(accMessage, { type: "done", sessionId: request.sessionId, reason: "error" });
      emit(event.sender, { type: "error", sessionId: request.sessionId, message });
      emit(event.sender, { type: "done", sessionId: request.sessionId, reason: "error" });
      persistRun();
      return { ok: false, error: message };
    }
  });

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
  registerUserIpc();
  registerModelIpc();
  registerSessionIpc();
  registerWorkspaceIpc();
  registerGitIpc();
  registerShellIpc();
  registerAgentIpc(broadcast);
  registerMcpIpc();
  registerCacheIpc();
  registerSkillsMarketIpc();
  registerSyncIpc();
  registerUpdaterIpc();
  registerBrowserIpc(broadcast);
  registerTerminalIpc(broadcast);
  createWindow();
  // ~/.zen 初始化 + agent-core 的 MCP 调用运行时（callMcpTool 在 mcp-ipc 内）
  void initZenDir().then(() => registerMcpRuntime(() => import("./mcp-ipc")));
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
});

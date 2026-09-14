import { join } from "node:path";

import { runMockAgent } from "@zen/agent-core";
import { BrowserWindow, app, ipcMain, shell } from "electron";

import { initUserState, registerUserIpc } from "./user-ipc";

import type { AgentRunRequest, AgentStreamEvent } from "@zen/shared";

const abortControllers = new Map<string, AbortController>();

function emit(webContents: Electron.WebContents, event: AgentStreamEvent): void {
  if (!webContents.isDestroyed()) {
    webContents.send("agent:event", event);
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 880,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#181818",
    title: "Zen",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
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

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
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
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  ipcMain.handle("agent:run", async (event, request: AgentRunRequest) => {
    if (!request?.sessionId || !request.userMessage) {
      return { ok: false, error: "invalid agent run request" };
    }

    abortControllers.get(request.sessionId)?.abort();
    const controller = new AbortController();
    abortControllers.set(request.sessionId, controller);

    try {
      await runMockAgent(request, controller.signal, (streamEvent) => {
        emit(event.sender, streamEvent);
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "agent run failed";
      emit(event.sender, { type: "error", message });
      return { ok: false, error: message };
    } finally {
      if (abortControllers.get(request.sessionId) === controller) {
        abortControllers.delete(request.sessionId);
      }
    }
  });

  ipcMain.handle("agent:cancel", (_event, sessionId: string) => {
    const controller = abortControllers.get(sessionId);
    if (!controller) {
      return { ok: false, error: "session not running" };
    }
    controller.abort();
    return { ok: true };
  });
}

app.whenReady().then(() => {
  registerIpc();
  registerUserIpc();
  createWindow();
  void initUserState();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

import { BrowserWindow, ipcMain } from "electron";

import type { ExternalRunEvent, ExternalSessionTrace } from "@zen/shared";

import { detectExternalCapabilities, sendExternalMessage, stopExternalRun } from "./external-resume";
import { attachResumability, readExternalTrace, scanExternalSessions } from "./external-sessions";

const EMPTY_TRACE: ExternalSessionTrace = { id: "", events: [], truncated: false };
const RUN_CHANNEL = "external-sessions:run";

/** 续聊流事件广播到所有窗口（pet 窗口也收到，但监听方只在主窗口注册） */
function broadcastRun(event: ExternalRunEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(RUN_CHANNEL, event);
    }
  }
}

/**
 * 外部 agent 会话 IPC：列表、轨迹、能力探测、续聊发送与停止。
 * 续聊的客户端 / 会话 ID / 目录全部由主进程从本地扫描结果推导，渲染层只传会话 id 与文本。
 */
export function registerExternalSessionsIpc(): void {
  ipcMain.handle("external-sessions:list", async () => {
    const [scan, capabilities] = await Promise.all([scanExternalSessions(), detectExternalCapabilities()]);
    return { ...scan, sessions: attachResumability(scan.sessions, capabilities) };
  });

  ipcMain.handle("external-sessions:trace", (_event, id: unknown) =>
    typeof id === "string" && id.trim() ? readExternalTrace(id) : EMPTY_TRACE,
  );

  ipcMain.handle("external-sessions:capabilities", () => detectExternalCapabilities());

  // 失败一律返回 { error, blocked }，不向渲染层抛异常
  ipcMain.handle("external-sessions:send", (_event, request: unknown) =>
    sendExternalMessage(request, broadcastRun),
  );

  ipcMain.handle("external-sessions:stop", (_event, runId: unknown) => ({
    ok: typeof runId === "string" && stopExternalRun(runId, broadcastRun),
  }));
}

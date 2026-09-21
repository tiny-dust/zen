import { ipcRenderer } from "electron";

import type {
  PtyDataEvent,
  PtyExitEvent,
  TerminalCreateResult,
  TerminalSessionInfo,
  TerminalShellInfo,
} from "@zen/shared";

export const terminalApi = {
  terminal: {
    shell(): Promise<TerminalShellInfo> {
      return ipcRenderer.invoke("terminal:shell");
    },
    font(): Promise<import("@zen/shared").TerminalFontSettings> {
      return ipcRenderer.invoke("terminal:font");
    },
    list(): Promise<TerminalSessionInfo[]> {
      return ipcRenderer.invoke("terminal:list");
    },
    create(options?: {
      cwd?: string;
      cols?: number;
      rows?: number;
      shell?: string;
    }): Promise<TerminalCreateResult> {
      return ipcRenderer.invoke("terminal:create", options);
    },
    write(sessionId: string, data: string): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("terminal:write", sessionId, data);
    },
    resize(sessionId: string, cols: number, rows: number): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("terminal:resize", sessionId, cols, rows);
    },
    kill(sessionId: string): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("terminal:kill", sessionId);
    },
    openExternal(cwd?: string): Promise<{ ok: boolean; opener?: string; error?: string }> {
      return ipcRenderer.invoke("terminal:open-external", cwd);
    },
    onData(handler: (event: PtyDataEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: PtyDataEvent) => {
        handler(payload);
      };
      ipcRenderer.on("pty:data", listener);
      return () => {
        ipcRenderer.removeListener("pty:data", listener);
      };
    },
    onExit(handler: (event: PtyExitEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: PtyExitEvent) => {
        handler(payload);
      };
      ipcRenderer.on("pty:exit", listener);
      return () => {
        ipcRenderer.removeListener("pty:exit", listener);
      };
    },
  },
};

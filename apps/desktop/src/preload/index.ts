import { contextBridge, ipcRenderer } from "electron";

import type { AgentRunRequest, AgentStreamEvent } from "@zen/shared";

export interface AppInfo {
  workspaceRoot: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

const zen = {
  app: {
    info(): Promise<AppInfo> {
      return ipcRenderer.invoke("app:info");
    },
  },
  agent: {
    run(request: AgentRunRequest): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:run", request);
    },
    cancel(sessionId: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:cancel", sessionId);
    },
    onEvent(handler: (event: AgentStreamEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentStreamEvent) => {
        handler(payload);
      };
      ipcRenderer.on("agent:event", listener);
      return () => {
        ipcRenderer.removeListener("agent:event", listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("zen", zen);

export type ZenApi = typeof zen;

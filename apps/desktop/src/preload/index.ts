import { contextBridge, ipcRenderer } from "electron";

import type {
  AgentRunRequest,
  AgentStreamEvent,
  AppSettings,
  AuthState,
} from "@zen/shared";

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
  auth: {
    state(): Promise<AuthState> {
      return ipcRenderer.invoke("auth:state");
    },
    login(): Promise<AuthState> {
      return ipcRenderer.invoke("auth:login");
    },
    logout(): Promise<AuthState> {
      return ipcRenderer.invoke("auth:logout");
    },
    onChanged(handler: (state: AuthState) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, state: AuthState) => {
        handler(state);
      };
      ipcRenderer.on("auth:changed", listener);
      return () => {
        ipcRenderer.removeListener("auth:changed", listener);
      };
    },
  },
  settings: {
    get(): Promise<AppSettings> {
      return ipcRenderer.invoke("settings:get");
    },
    set(partial: Partial<AppSettings>): Promise<AppSettings> {
      return ipcRenderer.invoke("settings:set", partial);
    },
    pickIcon(): Promise<AppSettings> {
      return ipcRenderer.invoke("settings:pick-icon");
    },
    applyIcon(): Promise<AppSettings> {
      return ipcRenderer.invoke("settings:apply-icon");
    },
    onChanged(handler: (settings: AppSettings) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings) => {
        handler(settings);
      };
      ipcRenderer.on("settings:changed", listener);
      return () => {
        ipcRenderer.removeListener("settings:changed", listener);
      };
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
      const listener = (_event: Electron.IpcRendererEvent, event: AgentStreamEvent) => {
        handler(event);
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

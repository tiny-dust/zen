import { contextBridge, ipcRenderer } from "electron";

import type {
  AgentRunRequest,
  AgentStreamEvent,
  AppSettings,
  AuthState,
  DeviceCodeInfo,
  FetchModelsResult,
  ModelCapabilities,
  ModelSelection,
  ProviderInput,
  ProviderModel,
  ProviderSummary,
  AddModelInput,
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
    openExternal(url: string): Promise<{ ok: boolean }> {
      return ipcRenderer.invoke("app:open-external", url);
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
    refreshProfile(): Promise<AuthState> {
      return ipcRenderer.invoke("auth:refresh-profile");
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
    onDeviceCode(handler: (info: DeviceCodeInfo) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, info: DeviceCodeInfo) => {
        handler(info);
      };
      ipcRenderer.on("auth:device-code", listener);
      return () => {
        ipcRenderer.removeListener("auth:device-code", listener);
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
  models: {
    list(): Promise<ProviderSummary[]> {
      return ipcRenderer.invoke("models:list");
    },
    selection(): Promise<ModelSelection & { provider?: ProviderSummary; model?: ProviderModel }> {
      return ipcRenderer.invoke("models:selection");
    },
    select(
      providerId: string | null,
      modelId: string | null,
    ): Promise<ModelSelection & { provider?: ProviderSummary; model?: ProviderModel }> {
      return ipcRenderer.invoke("models:select", providerId, modelId);
    },
    addProvider(input: ProviderInput): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:add-provider", input);
    },
    updateProvider(id: string, patch: Partial<ProviderInput>): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:update-provider", id, patch);
    },
    removeProvider(id: string): Promise<ProviderSummary[]> {
      return ipcRenderer.invoke("models:remove-provider", id);
    },
    addModel(input: AddModelInput): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:add-model", input);
    },
    removeModel(providerId: string, modelId: string): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:remove-model", providerId, modelId);
    },
    fetchFromProvider(providerId: string): Promise<FetchModelsResult> {
      return ipcRenderer.invoke("models:fetch-from-provider", providerId);
    },
    inspect(providerId: string, modelId: string): Promise<ModelCapabilities> {
      return ipcRenderer.invoke("models:inspect", providerId, modelId);
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

import { contextBridge, ipcRenderer, webUtils } from "electron";

import type {
  AddModelInput,
  AgentRunRequest,
  AgentStreamEvent,
  AppSettings,
  AuthState,
  CatalogMatch,
  CatalogModel,
  CatalogVendor,
  ChatMessage,
  DeviceCodeInfo,
  DirEntry,
  FetchModelsResult,
  ModelCapabilities,
  ModelSelection,
  PreviewModelsInput,
  ProviderInput,
  ProviderModel,
  ProviderSummary,
  ReadFileResult,
  SessionRecord,
  SetModelsEnabledInput,
  ToolApprovalDecision,
  UpdateModelInput,
  WorkspaceFile,
  Workspace,
  WorkspaceGroup,
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
  git: {
    info(cwd?: string): Promise<{ repo: string; branch: string }> {
      return ipcRenderer.invoke("git:info", cwd);
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
    updateModel(input: UpdateModelInput): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:update-model", input);
    },
    setEnabled(input: SetModelsEnabledInput): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:set-enabled", input);
    },
    removeModel(providerId: string, modelId: string): Promise<ProviderSummary> {
      return ipcRenderer.invoke("models:remove-model", providerId, modelId);
    },
    fetchFromProvider(providerId: string): Promise<FetchModelsResult> {
      return ipcRenderer.invoke("models:fetch-from-provider", providerId);
    },
    previewModels(input: PreviewModelsInput): Promise<FetchModelsResult> {
      return ipcRenderer.invoke("models:preview-models", input);
    },
    inspect(providerId: string, modelId: string): Promise<ModelCapabilities> {
      return ipcRenderer.invoke("models:inspect", providerId, modelId);
    },
    catalogVendors(): Promise<CatalogVendor[]> {
      return ipcRenderer.invoke("models:catalog-vendors");
    },
    catalogList(vendor?: string): Promise<CatalogModel[]> {
      return ipcRenderer.invoke("models:catalog-list", vendor);
    },
    catalogMatch(modelId: string): Promise<CatalogMatch> {
      return ipcRenderer.invoke("models:catalog-match", modelId);
    },
  },
  agent: {
    run(request: AgentRunRequest): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:run", request);
    },
    cancel(sessionId: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:cancel", sessionId);
    },
    pause(sessionId: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:pause", sessionId);
    },
    resume(sessionId: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:resume", sessionId);
    },
    resolveApproval(
      sessionId: string,
      decision: ToolApprovalDecision,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:approval", sessionId, decision);
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
  workspace: {
    listFiles(cwd?: string): Promise<WorkspaceFile[]> {
      return ipcRenderer.invoke("workspace:list-files", cwd);
    },
    readDir(cwd: string | undefined, relPath: string): Promise<DirEntry[] | null> {
      return ipcRenderer.invoke("workspace:read-dir", cwd, relPath);
    },
    readFile(
      cwd: string | undefined,
      relPath: string,
    ): Promise<ReadFileResult | null> {
      return ipcRenderer.invoke("workspace:read-file", cwd, relPath);
    },
    list(): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:list");
    },
    create(): Promise<Workspace | null> {
      return ipcRenderer.invoke("workspace:create");
    },
    archive(id: string, archived: boolean): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:archive", id, archived);
    },
    remove(id: string): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:delete", id);
    },
  },
  session: {
    create(workspaceId: string | null): Promise<SessionRecord> {
      return ipcRenderer.invoke("session:create", workspaceId);
    },
    open(
      id: string,
    ): Promise<{ session: SessionRecord; messages: ChatMessage[] } | null> {
      return ipcRenderer.invoke("session:open", id);
    },
    rename(id: string, title: string): Promise<void> {
      return ipcRenderer.invoke("session:rename", id, title);
    },
  },
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld("zen", zen);

export type ZenApi = typeof zen;

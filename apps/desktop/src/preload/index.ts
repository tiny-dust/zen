import { contextBridge, ipcRenderer, webUtils } from "electron";

import type {
  AddModelInput,
  AgentRunRequest,
  AgentSettings,
  AgentStreamEvent,
  AppSettings,
  AskUserAnswer,
  AuthState,
  CatalogMatch,
  CatalogModel,
  CatalogVendor,
  ChatMessage,
  DeviceCodeInfo,
  DirEntry,
  FetchModelsResult,
  GitBranches,
  GitCommitBatch,
  GitCommitDetail,
  GitLogEntry,
  GitPullRequest,
  GitStatus,
  McpServerConfig,
  McpServerStatus,
  ModelCapabilities,
  ModelSelection,
  PreviewModelsInput,
  PromptPreset,
  ProviderInput,
  ProviderModel,
  ProviderSummary,
  ReadFileResult,
  SessionRecord,
  SetModelsEnabledInput,
  SkillSummary,
  SyncResult,
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
  shell: {
    listOpeners(): Promise<Array<{ id: string; label: string; icon: string }>> {
      return ipcRenderer.invoke("shell:list-openers");
    },
    openWith(
      openerId: string,
      path: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("shell:open-with", openerId, path);
    },
    showInFolder(path: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("shell:show-in-folder", path);
    },
    openPath(path: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("shell:open-path", path);
    },
    platformInfo(): Promise<{
      platform: "darwin" | "win32" | "linux";
      showInFolderLabel: string;
      openFolderLabel: string;
    }> {
      return ipcRenderer.invoke("shell:platform-info");
    },
  },
  git: {
    info(cwd?: string): Promise<{ repo: string; branch: string }> {
      return ipcRenderer.invoke("git:info", cwd);
    },
    status(cwd?: string): Promise<GitStatus | null> {
      return ipcRenderer.invoke("git:status", cwd);
    },
    diff(cwd: string | undefined, path: string, staged = false): Promise<string | null> {
      return ipcRenderer.invoke("git:diff", cwd, path, staged);
    },
    commit(
      cwd: string | undefined,
      message: string,
      files: string[],
      options?: { push?: boolean; includeUnstaged?: boolean; autoMessage?: boolean },
    ): Promise<{ ok: boolean; error?: string; output?: string; message?: string }> {
      return ipcRenderer.invoke("git:commit", cwd, message, files, options);
    },
    log(cwd?: string): Promise<GitLogEntry[]> {
      return ipcRenderer.invoke("git:log", cwd);
    },
    commitDetail(cwd: string | undefined, hash: string): Promise<GitCommitDetail | null> {
      return ipcRenderer.invoke("git:commit-detail", cwd, hash);
    },
    commitFileDiff(
      cwd: string | undefined,
      hash: string,
      path: string,
    ): Promise<string | null> {
      return ipcRenderer.invoke("git:commit-diff", cwd, hash, path);
    },
    commitBatched(
      cwd: string | undefined,
      files: string[],
      options?: { push?: boolean },
    ): Promise<{ ok: boolean; batches: GitCommitBatch[]; error?: string }> {
      return ipcRenderer.invoke("git:commit-batched", cwd, files, options);
    },
    aiMessage(cwd?: string): Promise<string> {
      return ipcRenderer.invoke("git:ai-message", cwd);
    },
    createBranch(cwd: string | undefined, name: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("git:create-branch", cwd, name);
    },
    push(cwd?: string): Promise<{ ok: boolean; error?: string; output?: string }> {
      return ipcRenderer.invoke("git:push", cwd);
    },
    branches(cwd?: string): Promise<GitBranches> {
      return ipcRenderer.invoke("git:branches", cwd);
    },
    checkout(
      cwd: string | undefined,
      name: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("git:checkout", cwd, name);
    },
    pr(cwd?: string): Promise<GitPullRequest | null> {
      return ipcRenderer.invoke("git:pr", cwd);
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
    resolveAsk(
      sessionId: string,
      answer: AskUserAnswer,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("agent:ask-resolve", sessionId, answer);
    },
    getSettings(): Promise<AgentSettings> {
      return ipcRenderer.invoke("agent:get-settings");
    },
    setSettings(partial: Partial<AgentSettings>): Promise<AgentSettings> {
      return ipcRenderer.invoke("agent:set-settings", partial);
    },
    listSkills(): Promise<SkillSummary[]> {
      return ipcRenderer.invoke("agent:list-skills");
    },
    pickDirectory(): Promise<string | null> {
      return ipcRenderer.invoke("agent:pick-directory");
    },
    promptPresets(): Promise<PromptPreset[]> {
      return ipcRenderer.invoke("agent:prompt-presets");
    },
    sandboxDir(): Promise<string> {
      return ipcRenderer.invoke("agent:sandbox-dir");
    },
    rebuildSandbox(
      projectPath: string,
    ): Promise<{ ok: boolean; dir?: string; error?: string }> {
      return ipcRenderer.invoke("agent:rebuild-sandbox", projectPath);
    },
    onSettingsChanged(handler: (settings: AgentSettings) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, settings: AgentSettings) => {
        handler(settings);
      };
      ipcRenderer.on("agent:settings-changed", listener);
      return () => {
        ipcRenderer.removeListener("agent:settings-changed", listener);
      };
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
  mcp: {
    list(): Promise<McpServerStatus[]> {
      return ipcRenderer.invoke("mcp:list");
    },
    setServers(servers: McpServerConfig[]): Promise<McpServerStatus[]> {
      return ipcRenderer.invoke("mcp:set-servers", servers);
    },
  },
  sync: {
    upload(): Promise<SyncResult> {
      return ipcRenderer.invoke("sync:upload");
    },
    download(): Promise<SyncResult> {
      return ipcRenderer.invoke("sync:download");
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
    writeFile(
      cwd: string | undefined,
      relPath: string,
      content: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("workspace:write-file", cwd, relPath, content);
    },
    list(): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:list");
    },
    create(): Promise<Workspace | null> {
      return ipcRenderer.invoke("workspace:create");
    },
    pin(id: string, pinned: boolean): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:pin", id, pinned);
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
    setDraft(id: string, draft: string): Promise<void> {
      return ipcRenderer.invoke("session:set-draft", id, draft);
    },
    pin(id: string, pinned: boolean): Promise<void> {
      return ipcRenderer.invoke("session:pin", id, pinned);
    },
    archive(id: string, archived: boolean): Promise<void> {
      return ipcRenderer.invoke("session:archive", id, archived);
    },
    remove(id: string): Promise<void> {
      return ipcRenderer.invoke("session:delete", id);
    },
  },
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld("zen", zen);

export type ZenApi = typeof zen;

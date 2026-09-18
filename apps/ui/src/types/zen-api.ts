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
  UpdateStatusInfo,
  UpdateModelInput,
  WorkspaceFile,
  Workspace,
  WorkspaceGroup,
} from "@zen/shared";

export interface AppInfo {
  workspaceRoot: string;
  /** 应用版本（package.json version） */
  version: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

export type ModelSelectionState = ModelSelection & {
  provider?: ProviderSummary;
  model?: ProviderModel;
};

export interface DesktopOpener {
  id: string;
  label: string;
  icon: string;
}

export interface PlatformInfo {
  platform: "darwin" | "win32" | "linux";
  showInFolderLabel: string;
  openFolderLabel: string;
}

export interface ZenApi {
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<{ ok: boolean }>;
  };
  shell: {
    listOpeners(): Promise<DesktopOpener[]>;
    openWith(openerId: string, path: string): Promise<{ ok: boolean; error?: string }>;
    showInFolder(path: string): Promise<{ ok: boolean; error?: string }>;
    openPath(path: string): Promise<{ ok: boolean; error?: string }>;
    platformInfo(): Promise<PlatformInfo>;
  };
  git: {
    info(cwd?: string): Promise<{ repo: string; branch: string }>;
    status(cwd?: string): Promise<GitStatus | null>;
    diff(cwd: string | undefined, path: string, staged?: boolean): Promise<string | null>;
    commit(
      cwd: string | undefined,
      message: string,
      files: string[],
      options?: { push?: boolean; includeUnstaged?: boolean; autoMessage?: boolean },
    ): Promise<{ ok: boolean; error?: string; output?: string; message?: string }>;
    push(cwd?: string): Promise<{ ok: boolean; error?: string; output?: string }>;
    log(cwd?: string, ref?: string): Promise<GitLogEntry[]>;
    commitDetail(cwd: string | undefined, hash: string): Promise<GitCommitDetail | null>;
    commitFileDiff(cwd: string | undefined, hash: string, path: string): Promise<string | null>;
    commitBatched(
      cwd: string | undefined,
      files: string[],
      options?: { push?: boolean },
    ): Promise<{ ok: boolean; batches: GitCommitBatch[]; error?: string }>;
    aiMessage(cwd?: string): Promise<string>;
    createBranch(cwd: string | undefined, name: string): Promise<{ ok: boolean; error?: string }>;
    branches(cwd?: string): Promise<GitBranches>;
    checkout(cwd: string | undefined, name: string): Promise<{ ok: boolean; error?: string }>;
    pr(cwd?: string): Promise<GitPullRequest | null>;
  };
  auth: {
    state(): Promise<AuthState>;
    login(): Promise<AuthState>;
    logout(): Promise<AuthState>;
    refreshProfile(): Promise<AuthState>;
    onChanged(handler: (state: AuthState) => void): () => void;
    onDeviceCode(handler: (info: DeviceCodeInfo) => void): () => void;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(partial: Partial<AppSettings>): Promise<AppSettings>;
    pickIcon(): Promise<AppSettings>;
    applyIcon(): Promise<AppSettings>;
    onChanged(handler: (settings: AppSettings) => void): () => void;
  };
  updates: {
    check(): Promise<{ ok: boolean; error?: string }>;
    download(): Promise<{ ok: boolean; error?: string }>;
    install(): void;
    onStatus(handler: (status: UpdateStatusInfo) => void): () => void;
  };
  models: {
    list(): Promise<ProviderSummary[]>;
    selection(): Promise<ModelSelectionState>;
    select(providerId: string | null, modelId: string | null): Promise<ModelSelectionState>;
    addProvider(input: ProviderInput): Promise<ProviderSummary>;
    updateProvider(id: string, patch: Partial<ProviderInput>): Promise<ProviderSummary>;
    removeProvider(id: string): Promise<ProviderSummary[]>;
    addModel(input: AddModelInput): Promise<ProviderSummary>;
    updateModel(input: UpdateModelInput): Promise<ProviderSummary>;
    setEnabled(input: SetModelsEnabledInput): Promise<ProviderSummary>;
    removeModel(providerId: string, modelId: string): Promise<ProviderSummary>;
    fetchFromProvider(providerId: string): Promise<FetchModelsResult>;
    previewModels(input: PreviewModelsInput): Promise<FetchModelsResult>;
    inspect(providerId: string, modelId: string): Promise<ModelCapabilities>;
    catalogVendors(): Promise<CatalogVendor[]>;
    catalogList(vendor?: string): Promise<CatalogModel[]>;
    catalogMatch(modelId: string): Promise<CatalogMatch>;
  };
  agent: {
    run(request: AgentRunRequest): Promise<{ ok: boolean; error?: string }>;
    cancel(sessionId: string): Promise<{ ok: boolean; error?: string }>;
    pause(sessionId: string): Promise<{ ok: boolean; error?: string }>;
    resume(sessionId: string): Promise<{ ok: boolean; error?: string }>;
    resolveApproval(
      sessionId: string,
      decision: ToolApprovalDecision,
    ): Promise<{ ok: boolean; error?: string }>;
    resolveAsk(
      sessionId: string,
      answer: AskUserAnswer,
    ): Promise<{ ok: boolean; error?: string }>;
    getSettings(): Promise<AgentSettings>;
    setSettings(partial: Partial<AgentSettings>): Promise<AgentSettings>;
    listSkills(): Promise<SkillSummary[]>;
    pickDirectory(): Promise<string | null>;
    promptPresets(): Promise<PromptPreset[]>;
    sandboxDir(): Promise<string>;
    rebuildSandbox(projectPath: string): Promise<{ ok: boolean; dir?: string; error?: string }>;
    onSettingsChanged(handler: (settings: AgentSettings) => void): () => void;
    onEvent(handler: (event: AgentStreamEvent) => void): () => void;
  };
  mcp: {
    list(): Promise<McpServerStatus[]>;
    setServers(servers: McpServerConfig[]): Promise<McpServerStatus[]>;
  };
  sync: {
    upload(): Promise<SyncResult>;
    download(): Promise<SyncResult>;
  };
  workspace: {
    listFiles(cwd?: string): Promise<WorkspaceFile[]>;
    readDir(cwd: string | undefined, relPath: string): Promise<DirEntry[] | null>;
    readFile(cwd: string | undefined, relPath: string): Promise<ReadFileResult | null>;
    writeFile(
      cwd: string | undefined,
      relPath: string,
      content: string,
    ): Promise<{ ok: boolean; error?: string }>;
    list(): Promise<WorkspaceGroup[]>;
    create(): Promise<Workspace | null>;
    pin(id: string, pinned: boolean): Promise<WorkspaceGroup[]>;
    archive(id: string, archived: boolean): Promise<WorkspaceGroup[]>;
    remove(id: string): Promise<WorkspaceGroup[]>;
  };
  session: {
    create(workspaceId: string | null): Promise<SessionRecord>;
    open(id: string): Promise<{
      session: SessionRecord;
      messages: ChatMessage[];
      taskLists?: Array<{ version: number; items: import("@zen/shared").TaskItem[]; createdAt?: number }>;
    } | null>;
    rename(id: string, title: string): Promise<void>;
    setDraft(id: string, draft: string): Promise<void>;
    pin(id: string, pinned: boolean): Promise<void>;
    archive(id: string, archived: boolean): Promise<void>;
    remove(id: string): Promise<void>;
  };
  pathForFile(file: File): string;
}

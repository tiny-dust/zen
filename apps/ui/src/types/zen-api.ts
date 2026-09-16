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
  GitLogEntry,
  GitStatus,
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

export type ModelSelectionState = ModelSelection & {
  provider?: ProviderSummary;
  model?: ProviderModel;
};

export interface ZenApi {
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<{ ok: boolean }>;
  };
  git: {
    info(cwd?: string): Promise<{ repo: string; branch: string }>;
    status(cwd?: string): Promise<GitStatus | null>;
    diff(cwd: string | undefined, path: string, staged?: boolean): Promise<string | null>;
    commit(
      cwd: string | undefined,
      message: string,
      files: string[],
      push?: boolean,
    ): Promise<{ ok: boolean; error?: string; output?: string }>;
    log(cwd?: string): Promise<GitLogEntry[]>;
    aiMessage(cwd?: string): Promise<string>;
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
    onEvent(handler: (event: AgentStreamEvent) => void): () => void;
  };
  workspace: {
    listFiles(cwd?: string): Promise<WorkspaceFile[]>;
    readDir(cwd: string | undefined, relPath: string): Promise<DirEntry[] | null>;
    readFile(cwd: string | undefined, relPath: string): Promise<ReadFileResult | null>;
    list(): Promise<WorkspaceGroup[]>;
    create(): Promise<Workspace | null>;
    archive(id: string, archived: boolean): Promise<WorkspaceGroup[]>;
    remove(id: string): Promise<WorkspaceGroup[]>;
  };
  session: {
    create(workspaceId: string | null): Promise<SessionRecord>;
    open(id: string): Promise<{ session: SessionRecord; messages: ChatMessage[] } | null>;
    rename(id: string, title: string): Promise<void>;
  };
  pathForFile(file: File): string;
}

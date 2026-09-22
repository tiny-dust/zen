import type {
  AddModelInput,
  AgentRunRequest,
  AgentSettings,
  AgentStreamEvent,
  AppSettings,
  AskUserAnswer,
  AuthState,
  BrowserActionResult,
  BrowserConsoleEntry,
  BrowserElementRef,
  BrowserEvalResult,
  BrowserExtractResult,
  BrowserOpenResult,
  BrowserPerformanceMetrics,
  BrowserScreenshotResult,
  BrowserSnapshot,
  BrowserStatus,
  BrowserViewBounds,
  CatalogMatch,
  CatalogModel,
  CatalogVendor,
  ChatMessage,
  DeviceCodeInfo,
  DirEntry,
  FilePreview,
  FetchModelsResult,
  GitBranches,
  GitCommitBatch,
  GitCommitDetail,
  GitLogEntry,
  GitPullRequest,
  GitStatus,
  McpServerConfig,
  McpServerStatus,
  McpDiscoveredServer,
  MemoryScope,
  MemorySnapshot,
  ModelCapabilities,
  ModelSelection,
  PreviewModelsInput,
  PromptPreset,
  ProviderInput,
  ProviderModel,
  ProviderSummary,
  PtyDataEvent,
  PtyExitEvent,
  ReadFileResult,
  SessionRecord,
  SetModelsEnabledInput,
  SkillSummary,
  SyncResult,
  TerminalCreateResult,
  TerminalSessionInfo,
  TerminalShellInfo,
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
    createBranch(
      cwd: string | undefined,
      name: string,
      /** 基分支（本地或远程分支名）：缺省从当前 HEAD 创建 */
      base?: string,
    ): Promise<{ ok: boolean; error?: string }>;
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
  cache: {
    savePaste(payload: {
      name: string;
      mime?: string;
      data: ArrayBuffer | Uint8Array;
    }): Promise<{ ok: boolean; path?: string; error?: string }>;
    roots(): Promise<{ root: string; paste: string; screenshots: string }>;
  };
  skills: {
    marketSearch(query: string): Promise<{
      ok: boolean;
      items: import("@zen/shared").SkillMarketHit[];
      error?: string;
    }>;
    marketInstall(hit: import("@zen/shared").SkillMarketHit): Promise<{
      ok: boolean;
      dir?: string;
      error?: string;
    }>;
    marketCheckUpdates(skills: import("@zen/shared").SkillSummary[]): Promise<{
      ok: boolean;
      items: import("@zen/shared").SkillUpdateInfo[];
      error?: string;
    }>;
    marketUpdate(skill: import("@zen/shared").SkillSummary): Promise<{
      ok: boolean;
      dir?: string;
      error?: string;
    }>;
    uninstall(skill: import("@zen/shared").SkillSummary): Promise<{
      ok: boolean;
      error?: string;
    }>;
    analyze(req: {
      providerId: string;
      modelId: string;
    }): Promise<{ ok: boolean; report?: string; error?: string }>;
    /** 订阅一键分析的流式增量（skills:analyze 期间 main 定向推送） */
    onAnalyzeEvent(handler: (event: { text: string }) => void): () => void;
    userRoot(): Promise<string>;
  };
  mcp: {
    list(): Promise<McpServerStatus[]>;
    scan(workspaceRoot?: string): Promise<McpDiscoveredServer[]>;
    setServers(servers: McpServerConfig[]): Promise<McpServerStatus[]>;
  };
  memory: {
    get(): Promise<MemorySnapshot>;
    addNote(scope: MemoryScope, text: string): Promise<MemorySnapshot>;
    removeNote(scope: MemoryScope, id: string): Promise<MemorySnapshot>;
    collect(): Promise<MemorySnapshot>;
  };
  sync: {
    upload(): Promise<SyncResult>;
    download(): Promise<SyncResult>;
  };
  workspace: {
    listFiles(cwd?: string): Promise<WorkspaceFile[]>;
    readDir(cwd: string | undefined, relPath: string): Promise<DirEntry[] | null>;
    readFile(cwd: string | undefined, relPath: string): Promise<ReadFileResult | null>;
    /** 文件预览：图片 data URL / 文本截断 / 二进制 unsupported；path 可为绝对路径 */
    previewFile(cwd: string | undefined, path: string): Promise<FilePreview | null>;
    writeFile(
      cwd: string | undefined,
      relPath: string,
      content: string,
    ): Promise<{ ok: boolean; error?: string }>;
    list(): Promise<WorkspaceGroup[]>;
    create(): Promise<Workspace | null>;
    pin(id: string, pinned: boolean): Promise<WorkspaceGroup[]>;
    archive(id: string, archived: boolean): Promise<WorkspaceGroup[]>;
    rename(id: string, name: string): Promise<WorkspaceGroup[]>;
    remove(id: string): Promise<WorkspaceGroup[]>;
  };
  session: {
    create(workspaceId: string | null, id?: string): Promise<SessionRecord>;
    /** 会话迁移到其它工作区/公共区（composer 底栏选择器） */
    setWorkspace(id: string, workspaceId: string | null): Promise<void>;
    open(id: string): Promise<{
      session: SessionRecord;
      messages: ChatMessage[];
      taskLists?: Array<{ version: number; items: import("@zen/shared").TaskItem[]; createdAt?: number }>;
    } | null>;
    /** 渲染层自建消息落库（上下文压缩摘要卡）；main 侧会校验并拒绝非法载荷 */
    appendMessage(
      sessionId: string,
      message: ChatMessage,
    ): Promise<{ ok: boolean; error?: string }>;
    /** 编辑插入/重试分叉：删除该时刻起的落库消息 */
    trimMessages(
      sessionId: string,
      fromCreatedAt: number,
    ): Promise<{ ok: boolean; error?: string }>;
    rename(id: string, title: string): Promise<void>;
    /** 自动会话标题：main 侧用模型生成，失败返回 null（渲染层保留现有标题） */
    autoTitle(firstUserMessage: string, assistantReply?: string): Promise<string | null>;
    setDraft(id: string, draft: string): Promise<void>;
    pin(id: string, pinned: boolean): Promise<void>;
    archive(id: string, archived: boolean): Promise<void>;
    remove(id: string): Promise<void>;
  };
  pathForFile(file: File): string;
  browser: {
    status(): Promise<BrowserStatus>;
    ensureRunning(): Promise<BrowserStatus>;
    stop(): Promise<BrowserStatus>;
    setBounds(bounds: BrowserViewBounds | null, visible?: boolean): Promise<BrowserStatus>;
    setVisible(visible: boolean): Promise<BrowserStatus>;
    open(url: string): Promise<BrowserOpenResult>;
    goBack(): Promise<BrowserActionResult>;
    goForward(): Promise<BrowserActionResult>;
    reload(ignoreCache?: boolean): Promise<BrowserActionResult>;
    openExternal(url?: string): Promise<{ ok: boolean; error?: string }>;
    focusHost(): Promise<{ ok: boolean }>;
    debug(): Promise<Record<string, unknown>>;
    snapshot(): Promise<BrowserSnapshot>;
    extract(): Promise<BrowserExtractResult>;
    click(selector: string): Promise<BrowserActionResult>;
    type(
      selector: string,
      text: string,
      options?: { submit?: boolean },
    ): Promise<BrowserActionResult>;
    console(limit?: number): Promise<{ entries: BrowserConsoleEntry[] }>;
    performance(): Promise<BrowserPerformanceMetrics>;
    screenshot(): Promise<BrowserScreenshotResult>;
    evaluate(expression: string): Promise<BrowserEvalResult>;
    pickStart(): Promise<{ ok: boolean; error?: string }>;
    pickStop(): Promise<{ ok: boolean }>;
    onStatus(handler: (status: BrowserStatus) => void): () => void;
    onElementPicked(handler: (ref: BrowserElementRef) => void): () => void;
  };
  terminal: {
    shell(): Promise<TerminalShellInfo>;
    /** 系统终端字体（含 Nerd Font 回退栈） */
    font(): Promise<import("@zen/shared").TerminalFontSettings>;
    list(): Promise<TerminalSessionInfo[]>;
    create(options?: {
      cwd?: string;
      cols?: number;
      rows?: number;
      shell?: string;
    }): Promise<TerminalCreateResult>;
    write(sessionId: string, data: string): Promise<{ ok: boolean }>;
    resize(sessionId: string, cols: number, rows: number): Promise<{ ok: boolean }>;
    kill(sessionId: string): Promise<{ ok: boolean }>;
    openExternal(cwd?: string): Promise<{ ok: boolean; opener?: string; error?: string }>;
    onData(handler: (event: PtyDataEvent) => void): () => void;
    onExit(handler: (event: PtyExitEvent) => void): () => void;
  };
}

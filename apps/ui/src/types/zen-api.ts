import type {
  AbilityProbe,
  AddModelInput,
  AgentRunRequest,
  AgentSettings,
  AgentStreamEvent,
  AppSettings,
  AskUserAnswer,
  AuthState,
  OcrResult,
  TtsSpeakOptions,
  VoiceStartResult,
  VoiceTranscribeResult,
  BrowserActionResult,
  BrowserConsoleEntry,
  BrowserElementRef,
  BrowserEvalResult,
  BrowserExtractResult,
  BrowserOpenResult,
  BrowserPerformanceMetrics,
  BrowserScreenshotResult,
  BrowserSettings,
  BrowserSnapshot,
  BrowserStatus,
  BrowserViewBounds,
  CatalogMatch,
  CatalogModel,
  CatalogRefreshResult,
  CatalogVendor,
  ChatMessage,
  DeviceCodeInfo,
  DirEntry,
  FileCheckpoint,
  FilePreview,
  FetchModelsResult,
  GitBranches,
  GitCommitBatch,
  GitCommitDetail,
  GitLogEntry,
  GitPullRequest,
  GitStashEntry,
  GitStatus,
  GitSyncResult,
  LarkLoginEvent,
  LarkStatus,
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
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRunEvent,
  SessionRecord,
  SetModelsEnabledInput,
  AgentServiceInfo,
  SkillSummary,
  SyncResult,
  TerminalCreateResult,
  TerminalSessionInfo,
  TerminalShellInfo,
  ToolApprovalDecision,
  UpdateStatusInfo,
  UpdateModelInput,
  WebSearchApiProviderId,
  WebSearchStatus,
  WorkspaceFile,
  Workspace,
  WorkspaceGroup,
} from "@zen/shared";
import type { SessionMode } from "@zen/shared";

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
    openExternal(url: string): Promise<{ ok: boolean; error?: string }>;
    openSystemExternal(url: string): Promise<{ ok: boolean; error?: string }>;
  };
  shell: {
    listOpeners(): Promise<DesktopOpener[]>;
    openWith(openerId: string, path: string): Promise<{ ok: boolean; error?: string }>;
    showInFolder(path: string): Promise<{ ok: boolean; error?: string }>;
    openPath(path: string): Promise<{ ok: boolean; error?: string }>;
    platformInfo(): Promise<PlatformInfo>;
  };
  /** 窗口控制：三平台 chrome 均系统原生（红绿灯 / titleBarOverlay），此域仅剩 Linux 双击最大化兜底（apps/desktop/src/main/window-controls.ts） */
  window: {
    /** 平台标识（preload 的 process.platform，同步）：Linux 需要双击兜底 */
    getPlatform(): "darwin" | "win32" | "linux";
    toggleMaximize(): Promise<{ ok: boolean; maximized: boolean }>;
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
    /** 刷新远端状态，返回当前分支 ahead/behind（无上游时缺省） */
    fetch(cwd?: string): Promise<GitSyncResult>;
    /** 拉取并合并上游（无上游时报清晰错误；冲突时返回冲突文件列表） */
    pull(cwd?: string): Promise<GitSyncResult>;
    /** 合并指定分支：冲突时不自动 commit，返回冲突文件列表 */
    merge(cwd: string | undefined, branch: string): Promise<GitSyncResult>;
    /** 中止进行中的合并 */
    mergeAbort(cwd?: string): Promise<GitSyncResult>;
    /** 贮藏当前变更（-u 含未跟踪文件；message 可选） */
    stashPush(cwd: string | undefined, message?: string): Promise<GitSyncResult>;
    /** 应用贮藏：apply 保留条目，pop 应用成功后删除 */
    stashApply(cwd: string | undefined, index: number, mode?: "apply" | "pop"): Promise<GitSyncResult>;
    /** 贮藏列表 */
    stashList(cwd?: string): Promise<GitStashEntry[]>;
    /** 删除指定贮藏 */
    stashDrop(cwd: string | undefined, index: number): Promise<GitSyncResult>;
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
    onChanged(handler: (settings: AppSettings) => void): () => void;
    onGlobalCommand(handler: (command: string) => void): () => void;
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
    catalogRefresh(): Promise<CatalogRefreshResult>;
    catalogUpdatedAt(): Promise<number>;
  };
  agent: {
    run(request: AgentRunRequest): Promise<{ ok: boolean; error?: string }>;
    cancel(sessionId: string): Promise<{ ok: boolean; error?: string }>;
    pause(sessionId: string): Promise<{ ok: boolean; error?: string }>;
    resume(sessionId: string): Promise<{ ok: boolean; error?: string }>;
    /** 手动重试失败/取消的子 Agent（右栏 Agents 面板「重试」按钮） */
    retrySubAgent(sessionId: string, agentId: string): Promise<{ ok: boolean; error?: string }>;
    /** 插入执行：打断当前 run（保留 checkpoint），插入消息优先执行后自动恢复原 run */
    insert(sessionId: string, text: string): Promise<{ ok: boolean; error?: string }>;
    /** 运行中转向：打断当前 run，新指示以最高权重先执行后按新方向恢复原任务 */
    steer(sessionId: string, text: string): Promise<{ ok: boolean; error?: string }>;
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
    /** 会话文件快照：writeFile/editFile 写入前的原文件备份清单（最新在前） */
    listCheckpoints(sessionId: string): Promise<FileCheckpoint[]>;
    /** 把指定快照恢复回工作区原路径 */
    restoreCheckpoint(
      sessionId: string,
      checkpointId: string,
    ): Promise<{ ok: boolean; error?: string }>;
    pickDirectory(): Promise<string | null>;
    promptPresets(): Promise<PromptPreset[]>;
    sandboxDir(): Promise<string>;
    rebuildSandbox(projectPath: string): Promise<{ ok: boolean; dir?: string; error?: string }>;
    /** 网络搜索供应商 Key 配置状态（masked 为脱敏预览，仅设置页展示用） */
    webSearchStatus(): Promise<WebSearchStatus>;
    /** 保存/清除供应商 Key（null 或空串清除）；返回保存后的最新状态 */
    setWebSearchKey(
      provider: WebSearchApiProviderId,
      key: string | null,
    ): Promise<WebSearchStatus>;
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
    /** 发起浏览器 OAuth 授权；成功返回最新状态列表，失败 reject 中文错误 */
    authorize(serverId: string): Promise<McpServerStatus[]>;
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
    /** 重命名文件/目录（同目录改名；目标已存在报错）。区别于工作区分组的 rename。 */
    renameEntry(
      cwd: string | undefined,
      relPath: string,
      newName: string,
    ): Promise<{ ok: boolean; error?: string }>;
    /** 删除到系统废纸篓（跨平台 shell.trashItem） */
    trash(cwd: string | undefined, relPath: string): Promise<{ ok: boolean; error?: string }>;
    /** 递归复制到目标目录；同目录粘贴自动生成「name 副本」 */
    copy(
      cwd: string | undefined,
      srcRel: string,
      destDirRel: string,
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
    /** 会话级模型覆盖；null 表示跟随全局默认模型 */
    setModel(id: string, providerId: string | null, modelId: string | null): Promise<void>;
    /** 会话模式（interactive/plan/autopilot）；plan 批准后 main 自动切回 interactive */
    setMode(id: string, mode: SessionMode): Promise<void>;
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
    /** 会话分享导出：主进程弹保存框并写自包含 HTML；取消返回 { ok, canceled } */
    exportHtml(
      id: string,
    ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
    /** CLI `zen-cli open <sessionId>`：主进程广播请求，渲染层切到目标会话 */
    onOpenRequest(handler: (sessionId: string) => void): () => void;
  };
  pathForFile(file: File): string;
  browser: {
    /** 校正当前工作区的内嵌浏览器 scope（会话切换时由右栏面板 watch 驱动；preload 边界维护） */
    setScope(scope: string): void;
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
    getSettings(): Promise<BrowserSettings>;
    setSettings(partial: Partial<BrowserSettings>): Promise<BrowserSettings>;
    pipEnter(): Promise<BrowserStatus>;
    pipExit(): Promise<BrowserStatus>;
    pipHide(): Promise<BrowserStatus>;
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
  /** 长驻服务（runTerminal 起的 dev server 等）：主进程进程组跟踪，可关闭 */
  services: {
    list(): Promise<AgentServiceInfo[]>;
    kill(id: string): Promise<{ ok: boolean; error?: string }>;
    onChange(handler: (services: AgentServiceInfo[]) => void): () => void;
  };
  /** 飞书桥接：lark-cli 网关状态（lark:status / lark:changed，main 侧托管启停） */
  lark: {
    status(refresh?: boolean): Promise<LarkStatus>;
    installCli(): Promise<{ ok: boolean; error?: string }>;
    onChanged(handler: (status: LarkStatus) => void): () => void;
    /** 发起飞书登录（lark-cli device flow）；各阶段经 onLoginEvent 推送 */
    login(): Promise<void>;
    cancelLogin(): Promise<void>;
    /** 设置页发送测试问询卡片（验证卡片按钮回调链路） */
    testAskCard(): Promise<{ ok: boolean; error?: string }>;
    onLoginEvent(handler: (event: LarkLoginEvent) => void): () => void;
  };
  /** 定时/计划任务：到点自动在目标工作区运行 agent 并通知 */
  scheduler: {
    list(): Promise<ScheduledTask[]>;
    create(input: ScheduledTaskInput): Promise<ScheduledTask | { error: string }>;
    update(
      id: string,
      patch: Partial<ScheduledTaskInput>,
    ): Promise<ScheduledTask | null | { error: string }>;
    remove(id: string): Promise<{ ok: boolean }>;
    toggle(id: string, enabled: boolean): Promise<ScheduledTask | null>;
    /** 立即执行一次（不看 enabled 与调度周期），运行状态走 onRunEvent */
    runNow(id: string): Promise<{ ok: boolean; error?: string }>;
    onChanged(handler: (tasks: ScheduledTask[]) => void): () => void;
    onRunEvent(handler: (event: ScheduledTaskRunEvent) => void): () => void;
  };
  /** 可选功能目录（运行时分发）：目录 + probe 结果 */
  features: {
    list(): Promise<import("@zen/shared").FeatureCatalogResult>;
  };
  /** 语音输入（ASR）：点击开始/结束，转写文本回填输入框；probe 不支持时按钮隐藏 */
  voice: {
    probe(): Promise<AbilityProbe>;
    start(locale?: string): Promise<VoiceStartResult>;
    stop(): Promise<VoiceTranscribeResult>;
    /** 录音期间实时中间结果（partial 字幕）；返回取消订阅函数 */
    onPartial(handler: (text: string) => void): () => void;
  };
  /** TTS 播报：助手消息「朗读」；stop 打断当前播报 */
  tts: {
    probe(): Promise<AbilityProbe>;
    speak(text: string, options?: TtsSpeakOptions): Promise<{ ok: boolean; error?: string }>;
    stop(): Promise<{ ok: boolean }>;
  };
  /** OCR：图片附件「识别文字」，结果回填输入框 */
  ocr: {
    probe(): Promise<AbilityProbe>;
    recognize(imagePath: string): Promise<OcrResult>;
  };
  /** CUA 桌面自动化：agent 工具域（cuaEnabled 总开关控制），此处仅 probe */
  cua: {
    probe(): Promise<AbilityProbe>;
  };
}

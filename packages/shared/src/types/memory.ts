/**
 * 记忆（ADR-004 用户域）：~/.zen/memory 下的设备环境与用户习惯。
 * 设备快照由主进程启动时自动采集；备注（notes）由 Agent（updateMemory 工具）或用户补充。
 * 注入会话系统提示词，避免 Agent 每次重复探测路径、命令与环境。
 */

/** 记忆域：设备环境 / 用户习惯 */
export type MemoryScope = "device" | "user";

/**
 * 备注分类：设备域按「项目 / 硬件 / 环境变量 / 工具链 / 其他」归档，
 * 会话只注入分类索引（数量 + 摘要），正文由 readMemory 工具按需读取。
 */
export type MemoryCategory = "project" | "hardware" | "env" | "tool" | "other";

export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  "project",
  "hardware",
  "env",
  "tool",
  "other",
];

/** 一条记忆备注 */
export interface MemoryNote {
  id: string;
  text: string;
  createdAt: number;
  /** 归类（缺省按内容推断，见主进程 inferCategory） */
  category?: MemoryCategory;
}

/** 分类索引：只含数量与摘要，完整正文按需读取（避免整份记忆进上下文） */
export interface MemoryNoteGroup {
  category: MemoryCategory;
  count: number;
  /** 该类备注正文总字符数 */
  chars: number;
  /** 每条备注的首行摘要（截断），用于索引展示 */
  previews: string[];
}

/** 设备记忆索引视图：快照元信息 + 备注分类索引，不含备注正文 */
export interface DeviceMemoryIndex {
  collectedAt: number;
  platform: string;
  arch: string;
  home: string;
  shell: string;
  locale: string;
  timezone: string;
  tools: Record<string, string>;
  groups: MemoryNoteGroup[];
}

/** 设置页 / IPC 的记忆视图：设备域只给索引，正文按分类按需拉取 */
export interface MemoryView {
  device: DeviceMemoryIndex | null;
  user: UserMemory;
}

/** 设备环境记忆：自动采集快照 + 补充备注 */
export interface DeviceMemory {
  /** 快照采集时间（ms），重采会刷新 */
  collectedAt: number;
  platform: string;
  arch: string;
  home: string;
  /** 默认 shell（macOS/Linux $SHELL；Windows COMSPEC） */
  shell: string;
  locale: string;
  timezone: string;
  /** PATH 扫描清单版本；旧快照没有此字段。 */
  toolScanVersion?: number;
  /** PATH 上解析到的常用工具绝对路径（node/java/go/rustc/python…） */
  tools: Record<string, string>;
  notes: MemoryNote[];
}

/** 用户习惯记忆：仅备注 */
export interface UserMemory {
  notes: MemoryNote[];
}

/** 设置页/IPC 的记忆载荷 */
export interface MemorySnapshot {
  device: DeviceMemory | null;
  user: UserMemory;
}

/** 记忆整固（consolidation）：模型把累积 notes 合并/去重/改写成精炼结构 */
export interface MemoryConsolidationResult {
  /** 模型调用或 JSON 解析失败时为 false；此时绝不动原始数据 */
  ok: boolean;
  error?: string;
  scope: MemoryScope;
  /** 整固前的 notes（当前落盘内容） */
  before: MemoryNote[];
  /** 模型产出的整固后 notes（未落盘，待用户确认） */
  after: MemoryNote[];
  /** 内容有变化的条数（移除 + 新增/改写），0 表示模型认为无需整固 */
  changedCount: number;
}

// ---------------------------------------------------------------------------
// 对话记忆（对照 nomi 的长期记忆）：会话摘要（episodes）、事实（facts）、
// 用户档案（persona）、召回设置。与既有设备/习惯备注共存，互不覆盖。
// ---------------------------------------------------------------------------

/** 事实类别：身份 / 偏好 / 项目 / 目标 / 备注 */
export type MemoryFactKind = "identity" | "preference" | "project" | "goal" | "note";

export const MEMORY_FACT_KINDS: readonly MemoryFactKind[] = [
  "identity",
  "preference",
  "project",
  "goal",
  "note",
];

/** 事实来源：用户手写 or 模型自动提取（界面要能区分，便于核对） */
export type MemoryFactSource = "user" | "auto";

/** 一条对话记忆 = 一次会话的摘要 */
export interface MemoryEpisode {
  id: string;
  sessionId: string;
  workspaceId: string;
  title: string;
  summary: string;
  /** 召回用的关键词（模型给出的短语，缺失时按标题/摘要切片） */
  keywords: string[];
  messageCount: number;
  /** 置顶：召回时优先 */
  pinned: boolean;
  /** 用户改过摘要：自动重摘要不得覆盖 */
  edited: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 一条关于用户的事实 */
export interface MemoryFact {
  id: string;
  kind: MemoryFactKind;
  text: string;
  source: MemoryFactSource;
  pinned: boolean;
  /** 首次来源会话（自动提取时有值） */
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryModelRef {
  providerId: string;
  modelId: string;
}

/** 对话记忆设置；自动摘要/自动提取/召回默认关闭，由用户显式开启 */
export interface ConversationMemorySettings {
  /** 总开关：关闭后不自动摘要、不召回（已有数据保留） */
  enabled: boolean;
  autoSummarize: boolean;
  autoExtractFacts: boolean;
  recall: boolean;
  /** 每次最多召回几条 */
  topK: number;
  /** 摘要/提取用的模型；null = 用会话当前模型 */
  model: MemoryModelRef | null;
}

export interface ConversationMemoryStats {
  episodes: number;
  facts: number;
  personaChars: number;
}

/** 设置页一次拉取的总体状态 */
export interface ConversationMemoryState {
  settings: ConversationMemorySettings;
  stats: ConversationMemoryStats;
  /** 最近一次自动摘要/提取失败的原因（空 = 没失败过） */
  lastError: string;
}

export interface ConversationMemoryList {
  episodes: MemoryEpisode[];
  facts: MemoryFact[];
}

export interface MemoryIngestMessage {
  role: "user" | "assistant";
  content: string;
}

export interface MemoryIngestResult {
  ok: boolean;
  error?: string;
  /** 本次新写入/更新的摘要；模型认为没新内容时为 null */
  episode?: MemoryEpisode | null;
  factsAdded: number;
  /** 因模型没返回 / 数据太短而跳过 */
  skipped?: "too-short" | "no-content";
}

/** 召回命中（界面可在调试视图展示，提示词里只用 text） */
export interface MemoryRecallHit {
  kind: "episode" | "fact";
  id: string;
  title: string;
  text: string;
  score: number;
}

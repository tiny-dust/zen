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
  /** PATH 上解析到的常用工具绝对路径（node/npm/pnpm/git/python…） */
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

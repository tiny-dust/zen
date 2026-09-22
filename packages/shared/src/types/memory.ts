/**
 * 记忆（ADR-004 用户域）：~/.zen/memory 下的设备环境与用户习惯。
 * 设备快照由主进程启动时自动采集；备注（notes）由 Agent（updateMemory 工具）或用户补充。
 * 注入会话系统提示词，避免 Agent 每次重复探测路径、命令与环境。
 */

/** 记忆域：设备环境 / 用户习惯 */
export type MemoryScope = "device" | "user";

/** 一条记忆备注 */
export interface MemoryNote {
  id: string;
  text: string;
  createdAt: number;
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

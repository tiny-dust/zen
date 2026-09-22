import type { AgentDoneReason } from "./agent";

/**
 * 子 Agent 运行状态机：
 * waiting_deps → queued → running ⇄ waiting_user → done | error | cancelled
 * - waiting_user：askUser 等待用户回答（不是假「执行中」）
 * - waiting_deps：依赖未满足
 * running / waiting_user 均占用并发槽
 */
export type SubAgentStatus =
  | "queued"
  | "waiting_deps"
  | "waiting_user"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** 右侧面板展示的 Agent 节点（主 Agent + 子 Agent） */
export interface AgentNodeState {
  id: string;
  /** 所属主会话 id */
  sessionId: string;
  /** 父节点 id；主 Agent 为 null */
  parentId: string | null;
  /** 展示名 */
  name: string;
  /** 任务描述 */
  task: string;
  status: SubAgentStatus;
  /** 依赖的子 Agent id（全部完成后才入队执行） */
  dependsOn: string[];
  /** 失败重试次数 */
  attempts: number;
  maxAttempts: number;
  startedAt?: number;
  endedAt?: number;
  /** 终态摘要（成功结果或错误信息） */
  result?: string;
  error?: string;
  reason?: AgentDoneReason;
  /** 过程日志（截断存储） */
  log: Array<{ t: number; text: string }>;
  tokens?: { input: number; output: number };
  /** 是否正在占用写锁 / 终端 / 浏览器等独占资源 */
  busyResource?: "write" | "terminal" | "browser" | null;
  /** 是否在等待用户回答（与 status=waiting_user 等价的冗余标记，便于旧 UI） */
  waitingUser?: boolean;
}

export interface AgentTreeSnapshot {
  sessionId: string;
  agents: AgentNodeState[];
  /** 并发上限与当前运行数，便于 UI 展示资源竞争 */
  concurrency: { limit: number; running: number };
}

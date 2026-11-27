import type { ScheduledTaskSchedule } from "./scheduler";

/**
 * 持续任务契约（对齐 nomi 的任务体系，落地范围见各字段注释）。
 * 与旧「计划任务」的关系：`ScheduledTask` 继续原样可读可运行，任务页把它作为
 * `legacy` 分组呈现；本类型只描述新的普通任务 / 自动化。
 */
export type TaskStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting_user"
  | "needs_reconcile"
  | "awaiting_accept"
  | "done"
  | "failed"
  | "cancelled"
  | "expired";

/** 看板/列表的进度分档：待开始 / 进行中 / 待处理 / 已结束 */
export type TaskStage = "todo" | "in_progress" | "needs_you" | "done";

export type TaskPriority = "urgent" | "high" | "medium" | "low";
export type TaskCategory = "coding" | "review" | "research" | "writing" | "monitor" | "chore";
/** 执行者可用能力：只读 / 联网 / 写文件 / 跑命令（对外动作不提供，见审计说明） */
export type TaskToolClass = "read" | "web" | "file_write" | "shell";

/**
 * 触发器：
 * - manual：只在点「立即运行」时跑
 * - schedule：复用计划任务的调度表达（recurrence / once / ... 同一套到期算法）
 * - event：应用内事件（目前只有 `app.run.finished`：任意会话的一轮 agent 跑完）
 */
export type TaskTrigger =
  | { kind: "manual" }
  | { kind: "schedule"; schedule: ScheduledTaskSchedule }
  | { kind: "event"; source: TaskEventSource; filter?: string; cooldownMs?: number };

export type TaskEventSource = "app.run.finished";

export type TaskExecutor =
  | { kind: "notify"; text: string }
  | {
      kind: "agent";
      tools: TaskToolClass[];
      /** 空 = 用任务创建时的默认模型 */
      model?: string | null;
      /** 完成标准，注入提示词并显示在详情 */
      doneWhen?: string;
    };

/** 授权：等级由能力推出（0 通知 / 1 只读 / 2 本机写入 / 3 可跑命令），到期或撤销后不再执行 */
export interface TaskGrant {
  level: 0 | 1 | 2 | 3;
  /** 允许读写的目录（空 = 无文件权限） */
  paths: string[];
  grantedAt: number;
  expiresAt?: number;
  revokedAt?: number;
}

export interface TaskWait {
  kind: "approval" | "input" | "grant";
  requestId?: string;
  detail?: string;
  /** 决定之后回到哪个状态 */
  resumeTo: "running" | "queued" | "idle";
}

export interface TaskError {
  code: string;
  message: string;
}

export interface TaskUsage {
  inputTokens: number;
  outputTokens: number;
}

/** 一次执行（attempt）：任务的每次运行都留一条 */
export interface TaskAttempt {
  id: string;
  taskId: string;
  gen: number;
  cause: "manual" | "schedule" | "event" | "retry" | "resume" | "followup";
  status: "running" | "waiting_user" | "awaiting_accept" | "succeeded" | "failed" | "cancelled" | "interrupted" | "rejected";
  startedAt: number;
  endedAt?: number;
  usage: TaskUsage;
  /** 本次执行复用的会话（Zen 每次执行落在独立会话里，可从侧栏回看完整过程） */
  sessionId?: string;
  result?: { summary: string };
  error?: TaskError;
}

/** 事件日志：状态流转与对外动作的追加记录 */
export interface TaskJournalEntry {
  seq: number;
  taskId: string;
  at: number;
  /** transition = 状态变化；note = 说明；run = 执行 */
  type: "transition" | "note" | "run";
  from?: TaskStatus;
  to?: TaskStatus;
  summary?: string;
  attemptId?: string;
}

/** 队列信息：运行时实时计算，不落盘 */
export interface TaskQueueInfo {
  reason: "slot" | "retry";
  position: number;
  retryAt?: number;
  activeCount: number;
  maxConcurrent: number;
}

export interface Task {
  id: string;
  title: string;
  goal: string;
  /** 从对话派生的任务记住来源会话 */
  originConversationId?: string;
  trigger: TaskTrigger;
  executor: TaskExecutor;
  grant: TaskGrant;
  budget: { maxRetries: number };
  /** 做完怎么算收下：auto = 直接完成；user = 等你验收 */
  acceptance: "auto" | "user";
  priority?: TaskPriority;
  category?: TaskCategory;
  status: TaskStatus;
  enabled: boolean;
  gen: number;
  retryCount: number;
  consecutiveFailures: number;
  wait?: TaskWait;
  nextRunAt?: number;
  lastError?: TaskError;
  lastAttemptId?: string;
  lastRunAt?: number;
  lastRunStatus?: "succeeded" | "failed" | "cancelled";
  endedAt?: number;
  archivedAt?: number;
  ackedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskInput {
  title: string;
  goal: string;
  trigger: TaskTrigger;
  executor: TaskExecutor;
  acceptance?: "auto" | "user";
  priority?: TaskPriority;
  category?: TaskCategory;
  budget?: { maxRetries?: number };
  /** 授权由渲染层按所选能力/目录/期限推导，主进程再逐项校验 */
  grant: Omit<TaskGrant, "grantedAt">;
}

export interface TaskListResult {
  tasks: Task[];
  queue: Record<string, TaskQueueInfo>;
}

/** 任务实时事件（tasks:event）：页面据此刷新与追加执行流 */
export type TaskStreamEvent =
  | { type: "changed"; taskId: string }
  | { type: "run"; taskId: string; attemptId: string; phase: "started" | "finished" | "error"; summary?: string };

/** 已完成/已取消的任务多久后自动归档 */
export const TASK_AUTO_ARCHIVE_MS = 24 * 3600_000;
/** 同刻并发执行上限 */
export const TASK_MAX_CONCURRENT = 2;

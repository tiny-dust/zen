import type {
  ScheduledTaskSchedule,
  Task,
  TaskAttempt,
  TaskExecutor,
  TaskGrant,
  TaskStage,
  TaskStatus,
  TaskToolClass,
  TaskTrigger,
} from "@zen/shared";

/**
 * 任务的纯派生逻辑：阶段归属、分组、可归档判断、文案键、时间格式化。
 * 只做映射与拼接，不依赖 i18n 实例与 store，组件里用 t(text.key, text.params) 渲染。
 */

/** 文案键 + 参数（交给 vue-i18n 渲染，保持纯函数可测） */
export interface TaskText {
  key: string;
  params?: Record<string, string | number>;
}

/** 看板四列的顺序（与 nomi 一致：待开始 → 进行中 → 待处理 → 已结束） */
export const TASK_STAGES: TaskStage[] = ["todo", "in_progress", "needs_you", "done"];

const STAGE_BY_STATUS: Record<TaskStatus, TaskStage> = {
  idle: "todo",
  queued: "todo",
  running: "in_progress",
  needs_reconcile: "in_progress",
  waiting_user: "needs_you",
  awaiting_accept: "needs_you",
  done: "done",
  failed: "done",
  cancelled: "done",
  expired: "done",
};

const TERMINAL_STATUSES: TaskStatus[] = ["done", "failed", "cancelled", "expired"];

export function stageOf(status: TaskStatus): TaskStage {
  return STAGE_BY_STATUS[status];
}

export function groupOf(task: Task): TaskStage {
  return stageOf(task.status);
}

/** 需要用户处理（补充信息 / 验收）——待处理入口与计数共用 */
export function needsYou(task: Task): boolean {
  return stageOf(task.status) === "needs_you";
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * 可归档：已归档的不再显示归档；未结束的先跑完/取消。
 * 失败任务要求先「知道了」（ackedAt），避免错误信息被静默收进归档。
 */
export function canArchive(task: Task): boolean {
  if (task.archivedAt) {
    return false;
  }
  if (!isTerminal(task.status)) {
    return false;
  }
  return task.status !== "failed" || Boolean(task.ackedAt);
}

export function statusLabel(status: TaskStatus): TaskText {
  return { key: `tasks.status.${status}` };
}

const UNIT_TRIGGER_KEYS: Record<"second" | "minute" | "hour", string> = {
  second: "tasks.trigger.everySecond",
  minute: "tasks.trigger.everyMinute",
  hour: "tasks.trigger.everyHour",
};

/** 周一到周五视为「工作日」，其余周组合走通用周几文案 */
function isWorkdays(weekdays: number[]): boolean {
  return weekdays.length === 5 && [1, 2, 3, 4, 5].every((day) => weekdays.includes(day));
}

function scheduleLabel(schedule: ScheduledTaskSchedule): TaskText {
  const times = (schedule.times ?? []).join(" ");
  if (schedule.kind === "once") {
    return { key: "tasks.trigger.once", params: { time: fmtTime(schedule.at) } };
  }
  if (schedule.kind === "interval") {
    const unit = schedule.unit === "second" || schedule.unit === "hour" ? schedule.unit : "minute";
    return { key: UNIT_TRIGGER_KEYS[unit], params: { n: schedule.every ?? 1 } };
  }
  if (schedule.kind === "daily") {
    return { key: "tasks.trigger.daily", params: { times: schedule.time ?? "" } };
  }
  if (schedule.kind === "monthly") {
    return { key: "tasks.trigger.monthly", params: { day: schedule.day ?? 1, times: schedule.time ?? "" } };
  }
  if (schedule.kind === "dates") {
    return { key: "tasks.trigger.dates", params: { n: (schedule.dates ?? []).length, times } };
  }
  if (schedule.kind === "window") {
    return {
      key: "tasks.trigger.window",
      params: { start: schedule.startTime ?? "", end: schedule.endTime ?? "", n: schedule.everyMinutes ?? 0 },
    };
  }
  const unit = schedule.unit ?? "day";
  if (unit === "second" || unit === "minute" || unit === "hour") {
    return { key: UNIT_TRIGGER_KEYS[unit], params: { n: schedule.every ?? 1 } };
  }
  if (unit === "week") {
    const weekdays = schedule.weekdays ?? [];
    return isWorkdays(weekdays)
      ? { key: "tasks.trigger.workdays", params: { times } }
      : { key: "tasks.trigger.weekly", params: { days: weekdays.join(","), times } };
  }
  if (unit === "month") {
    const day = schedule.monthlyOn?.mode === "day" ? schedule.monthlyOn.day : 1;
    return { key: "tasks.trigger.monthly", params: { day, times } };
  }
  return (schedule.every ?? 1) > 1
    ? { key: "tasks.trigger.everyDays", params: { n: schedule.every ?? 1, times } }
    : { key: "tasks.trigger.daily", params: { times } };
}

export function triggerLabel(trigger: TaskTrigger): TaskText {
  if (trigger.kind === "manual") {
    return { key: "tasks.trigger.manual" };
  }
  if (trigger.kind === "event") {
    return { key: "tasks.trigger.event" };
  }
  return scheduleLabel(trigger.schedule);
}

export function executorLabel(executor: TaskExecutor): TaskText {
  return executor.kind === "notify" ? { key: "tasks.executor.notify" } : { key: "tasks.executor.agent" };
}

export function toolLabel(tool: TaskToolClass): TaskText {
  return { key: `tasks.tool.${tool}` };
}

/** 能力等级：0 通知 / 1 只读 / 2 本机写入 / 3 可跑命令（与 TaskGrant.level 一致） */
export function grantLevelOf(tools: TaskToolClass[]): TaskGrant["level"] {
  if (tools.includes("shell")) {
    return 3;
  }
  if (tools.includes("file_write")) {
    return 2;
  }
  if (tools.includes("read")) {
    return 1;
  }
  return 0;
}

export function grantLevelLabel(level: TaskGrant["level"]): TaskText {
  return { key: `tasks.grant.level${level}` };
}

const ATTEMPT_STATUS_KEYS: Record<TaskAttempt["status"], string> = {
  running: "tasks.attemptStatus.running",
  waiting_user: "tasks.attemptStatus.waiting_user",
  awaiting_accept: "tasks.attemptStatus.awaiting_accept",
  succeeded: "tasks.attemptStatus.succeeded",
  failed: "tasks.attemptStatus.failed",
  cancelled: "tasks.attemptStatus.cancelled",
  interrupted: "tasks.attemptStatus.interrupted",
  rejected: "tasks.attemptStatus.rejected",
};

export function attemptStatusLabel(status: TaskAttempt["status"]): TaskText {
  return { key: ATTEMPT_STATUS_KEYS[status] };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 「MM-DD HH:mm」；空值返回空串，卡片与详情共用（避免各写一套） */
export function fmtTime(at?: number | null): string {
  if (!at) {
    return "";
  }
  const date = new Date(at);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 用时：<1 分钟按秒、<1 小时按分、更长按时分 */
export function fmtDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h${pad(minutes % 60)}m`;
}

/** 最近一次结果的单行摘要（卡片用；空结果给空串由组件兜底） */
export function resultSummary(task: Task, summary?: string | null): string {
  const text = (summary ?? "").trim();
  return text || task.lastError?.message?.trim() || "";
}

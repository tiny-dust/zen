import type { ScheduledTask, ScheduleUnit, ScheduledTaskSchedule } from "@zen/shared";

/**
 * 定时任务调度纯函数（无 electron / DB 依赖，可单测）：
 * 各类调度的校验与到期判断。主循环 scheduler.ts 每 tick 调 isTaskDue。
 */

/** 固定毫秒单位的换算（month 依赖月历，单独走 addMonths） */
const UNIT_MS: Record<Exclude<ScheduleUnit, "month">, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/** 解析时刻 "HH:mm"（本地时区，24 小时制）；非法返回 null */
export function parseTimeOfDay(
  value: string | undefined | null,
): { hours: number; minutes: number } | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return { hours, minutes };
}

/** 本地时区某时刻所在日的 00:00 时间戳 */
function startOfLocalDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 本地时区某月的最后一天（1-31） */
function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * 时间戳加 N 个月（day 溢出时收敛到目标月最后一天，如 1/31 + 1 月 = 2/28）。
 * interval 的 month 单位与 monthly 的「当月无该日取月末」共用这一语义。
 */
function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  const day = d.getDate();
  const target = new Date(
    d.getFullYear(),
    d.getMonth() + months,
    1,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  );
  target.setDate(Math.min(day, lastDayOfMonth(target.getFullYear(), target.getMonth())));
  return target.getTime();
}

/** 校验 interval 调度：every >=1 整数 + 合法单位 */
function isValidInterval(schedule: Partial<ScheduledTaskSchedule>): boolean {
  return (
    Number.isInteger(schedule.every) &&
    (schedule.every ?? 0) >= 1 &&
    (["second", "minute", "hour", "day", "month"] as ScheduleUnit[]).includes(
      schedule.unit as ScheduleUnit,
    )
  );
}

/** 校验 window 调度：起止均合法且起点早于终点（不支持跨零点），间隔分钟 >=1 */
function isValidWindow(schedule: Partial<ScheduledTaskSchedule>): boolean {
  const start = parseTimeOfDay(schedule.startTime);
  const end = parseTimeOfDay(schedule.endTime);
  if (!start || !end) {
    return false;
  }
  if (start.hours > end.hours || (start.hours === end.hours && start.minutes >= end.minutes)) {
    return false;
  }
  return Number.isInteger(schedule.everyMinutes) && (schedule.everyMinutes ?? 0) >= 1;
}

/** 校验调度结构是否可执行（创建/更新入参也用它把关）；类型谓词，通过即视为合法 ScheduledTaskSchedule */
export function isValidSchedule(schedule: unknown): schedule is ScheduledTaskSchedule {
  if (!schedule || typeof schedule !== "object") {
    return false;
  }
  const candidate = schedule as Partial<ScheduledTaskSchedule>;
  switch (candidate.kind) {
    case "interval":
      return isValidInterval(candidate);
    case "daily":
      return parseTimeOfDay(candidate.time) !== null;
    case "monthly":
      return (
        Number.isInteger(candidate.day) &&
        (candidate.day ?? 0) >= 1 &&
        (candidate.day ?? 0) <= 31 &&
        parseTimeOfDay(candidate.time) !== null
      );
    case "once":
      return Number.isInteger(candidate.at) && (candidate.at ?? 0) > 0;
    case "window":
      return isValidWindow(candidate);
    default:
      return false;
  }
}

/** interval：距上次运行（或创建）满 N 个单位到期 */
function isIntervalDue(task: ScheduledTask, now: number): boolean {
  const schedule = task.schedule;
  const unit = schedule.unit;
  if (!isValidInterval(schedule) || !unit) {
    return false;
  }
  const base = task.lastRunAt ?? task.createdAt;
  const every = schedule.every ?? 0;
  if (unit === "month") {
    return now >= addMonths(base, every);
  }
  return now - base >= UNIT_MS[unit] * every;
}

/** daily：今天已过 HH:mm 且上次运行在今天 HH:mm 之前（关机错过会在下次 tick 补跑一次） */
function isDailyDue(task: ScheduledTask, now: number): boolean {
  const time = parseTimeOfDay(task.schedule.time);
  if (!time) {
    return false;
  }
  const todayAt = startOfLocalDay(now) + time.hours * 3_600_000 + time.minutes * 60_000;
  if (now < todayAt) {
    return false;
  }
  return task.lastRunAt === null || task.lastRunAt < todayAt;
}

/** monthly：本月（day 超出当月天数取月末）已过 day 日 HH:mm 且上次运行在该时刻之前 */
function isMonthlyDue(task: ScheduledTask, now: number): boolean {
  const time = parseTimeOfDay(task.schedule.time);
  const day = task.schedule.day ?? 0;
  if (!time || !Number.isInteger(day) || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(now);
  const occurrence =
    new Date(
      d.getFullYear(),
      d.getMonth(),
      Math.min(day, lastDayOfMonth(d.getFullYear(), d.getMonth())),
      time.hours,
      time.minutes,
    ).getTime();
  if (now < occurrence) {
    return false;
  }
  return task.lastRunAt === null || task.lastRunAt < occurrence;
}

/** once：到点且从未运行过（执行后主进程自动停用，lastRunAt 兜底防重放） */
function isOnceDue(task: ScheduledTask, now: number): boolean {
  const at = task.schedule.at ?? 0;
  if (!Number.isInteger(at) || at <= 0) {
    return false;
  }
  return now >= at && task.lastRunAt === null;
}

/** window：今天处于 [start, end] 内，且距上次运行（或今日窗口起点/首次进入）满 everyMinutes */
function isWindowDue(task: ScheduledTask, now: number): boolean {
  const schedule = task.schedule;
  if (!isValidWindow(schedule)) {
    return false;
  }
  const start = parseTimeOfDay(schedule.startTime)!;
  const end = parseTimeOfDay(schedule.endTime)!;
  const todayStart = startOfLocalDay(now);
  const windowStart = todayStart + start.hours * 3_600_000 + start.minutes * 60_000;
  const windowEnd = todayStart + end.hours * 3_600_000 + end.minutes * 60_000;
  if (now < windowStart || now > windowEnd) {
    return false;
  }
  const base = task.lastRunAt;
  if (base === null) {
    return true;
  }
  // 昨天及更早的运行不算：每天窗口重新开始
  if (base < todayStart) {
    return true;
  }
  return now - base >= (schedule.everyMinutes ?? 0) * 60_000;
}

/**
 * 任务在 now 时刻是否到期（不含 enabled 判断，调用方先过滤禁用任务）。
 * 进行中的任务由调用方用 runningIds 去重。
 */
export function isTaskDue(task: ScheduledTask, now: number): boolean {
  switch (task.schedule.kind) {
    case "interval":
      return isIntervalDue(task, now);
    case "daily":
      return isDailyDue(task, now);
    case "monthly":
      return isMonthlyDue(task, now);
    case "once":
      return isOnceDue(task, now);
    case "window":
      return isWindowDue(task, now);
    default:
      return false;
  }
}

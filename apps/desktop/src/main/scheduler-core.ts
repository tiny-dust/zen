import type { ScheduledTask, ScheduledTaskSchedule } from "@zen/shared";

/**
 * 定时任务调度纯函数（无 electron / DB 依赖，可单测）：
 * 到期判断与每日 HH:mm 解析。主循环 scheduler.ts 每 tick 调 isTaskDue。
 */

/** 解析每日触发时刻 "HH:mm"（本地时区，24 小时制）；非法返回 null */
export function parseDailyTime(
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

/** 校验调度结构是否可执行（创建/更新入参也用它把关）；类型谓词，通过即视为合法 ScheduledTaskSchedule */
export function isValidSchedule(schedule: unknown): schedule is ScheduledTaskSchedule {
  if (!schedule || typeof schedule !== "object") {
    return false;
  }
  const candidate = schedule as Partial<ScheduledTaskSchedule>;
  if (candidate.kind === "interval") {
    return Number.isInteger(candidate.intervalMinutes) && (candidate.intervalMinutes ?? 0) >= 1;
  }
  if (candidate.kind === "daily") {
    return parseDailyTime(candidate.dailyTime) !== null;
  }
  return false;
}

/** 本地时区某时刻所在日的 00:00 时间戳 */
function startOfLocalDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * 任务在 now 时刻是否到期（不含 enabled 判断，调用方先过滤禁用任务）：
 * - interval：距上次运行（或创建）满 N 分钟；
 * - daily：今天已过 HH:mm 且上次运行在今天 HH:mm 之前（应用关机错过会在下次 tick 补跑一次）。
 * 进行中的任务由调用方用 runningIds 去重。
 */
export function isTaskDue(task: ScheduledTask, now: number): boolean {
  const schedule = task.schedule;
  if (schedule.kind === "interval") {
    const minutes = schedule.intervalMinutes ?? 0;
    if (!Number.isInteger(minutes) || minutes < 1) {
      return false;
    }
    const base = task.lastRunAt ?? task.createdAt;
    return now - base >= minutes * 60_000;
  }
  if (schedule.kind === "daily") {
    const time = parseDailyTime(schedule.dailyTime);
    if (!time) {
      return false;
    }
    const todayAt = startOfLocalDay(now) + time.hours * 3_600_000 + time.minutes * 60_000;
    if (now < todayAt) {
      return false;
    }
    return task.lastRunAt === null || task.lastRunAt < todayAt;
  }
  return false;
}

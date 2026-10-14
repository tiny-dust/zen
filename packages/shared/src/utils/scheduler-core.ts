import type { MonthlyPattern, ScheduledTask, ScheduleUnit, ScheduledTaskSchedule } from "../types";

/**
 * 定时任务调度纯函数（无 electron / DB 依赖，可单测）：
 * 各类调度的校验、到期判断、指定日匹配（日历高亮）与下次运行预览。
 * 主进程 scheduler.ts 每 tick 调 isTaskDue；渲染层用 matchesDate / nextOccurrences 做预览。
 *
 * 周期锚点约定：every N 天/周/月的「第几期」一律以 Unix 纪元（1970-01-01，周一起始的周）
 * 为锚对齐取模——与 lastRunAt 无关，保证执行与预览对同一天给出一致答案。
 */

/** 固定毫秒单位的换算（week/month 依赖日历，单独走 addDays/addMonths） */
const UNIT_MS: Record<Exclude<ScheduleUnit, "week" | "month">, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/** recurrence 有效单位 */
const RECURRENCE_UNITS: ScheduleUnit[] = ["second", "minute", "hour", "day", "week", "month"];
/** 旧 interval 类型的有效单位（week 只属于 recurrence） */
const INTERVAL_UNITS: ScheduleUnit[] = ["second", "minute", "hour", "day", "month"];
/** 需要 times 时刻列表的 recurrence 单位 */
const TIMED_UNITS: ScheduleUnit[] = ["day", "week", "month"];

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

/** 本地时区日期的 "YYYY-MM-DD"（date/dates/until 的存储格式） */
export function localDateISO(d: Date): string {
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 解析 "YYYY-MM-DD" 为本地时区当日 00:00 的 Date；非法返回 null */
export function parseLocalDate(value: string | undefined | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [y = 0, m = 0, d = 0] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
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

/** 纪元（1970-01-01 是周四）起以周一为周首的第几期索引 */
function weekIndexSinceEpoch(date: Date): number {
  const thursdayOffset = 3; // 1970-01-01（周四）到本周周一的天数
  const start = startOfLocalDay(date.getTime()) - thursdayOffset * 86_400_000;
  return Math.floor(start / (7 * 86_400_000));
}

/** 纪元起第几个月（1970-01 为第 0 月） */
function monthIndexSinceEpoch(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/** 某月第 nth 个 weekday 是几号（不存在——当月不足——返回 0） */
function nthWeekdayOfMonth(year: number, monthIndex: number, nth: number, weekday: number): number {
  const first = new Date(year, monthIndex, 1).getDay();
  const offset = (weekday - first + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return day <= lastDayOfMonth(year, monthIndex) ? day : 0;
}

/** 校验 recurrence：every/unit 合法；周→weekdays 非空、月→monthlyOn 合法、天/周/月→times 非空且合法 */
function isValidRecurrence(schedule: Partial<ScheduledTaskSchedule>): boolean {
  if (
    !Number.isInteger(schedule.every) ||
    (schedule.every ?? 0) < 1 ||
    !RECURRENCE_UNITS.includes(schedule.unit as ScheduleUnit)
  ) {
    return false;
  }
  const unit = schedule.unit as ScheduleUnit;
  if (TIMED_UNITS.includes(unit)) {
    const times = schedule.times;
    if (!Array.isArray(times) || times.length === 0) {
      return false;
    }
    if (times.some((time) => parseTimeOfDay(time) === null)) {
      return false;
    }
  }
  if (unit === "week") {
    const weekdays = schedule.weekdays;
    if (
      !Array.isArray(weekdays) ||
      weekdays.length === 0 ||
      weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      return false;
    }
  }
  if (unit === "month") {
    const monthlyOn = schedule.monthlyOn as MonthlyPattern | undefined;
    if (!monthlyOn || typeof monthlyOn !== "object") {
      return false;
    }
    if (monthlyOn.mode === "day") {
      if (!Number.isInteger(monthlyOn.day) || monthlyOn.day < 1 || monthlyOn.day > 31) {
        return false;
      }
    } else if (monthlyOn.mode === "nthWeekday") {
      if (
        !Number.isInteger(monthlyOn.nth) ||
        monthlyOn.nth < 1 ||
        monthlyOn.nth > 5 ||
        !Number.isInteger(monthlyOn.weekday) ||
        monthlyOn.weekday < 0 ||
        monthlyOn.weekday > 6
      ) {
        return false;
      }
    } else {
      return false;
    }
  }
  if (schedule.until !== undefined && parseLocalDate(schedule.until) === null) {
    return false;
  }
  return true;
}

/** 校验 dates：dates 非空且均为合法日期，times 非空且合法 */
function isValidDates(schedule: Partial<ScheduledTaskSchedule>): boolean {
  const dates = schedule.dates;
  if (
    !Array.isArray(dates) ||
    dates.length === 0 ||
    dates.some((date) => parseLocalDate(date) === null)
  ) {
    return false;
  }
  const times = schedule.times;
  return (
    Array.isArray(times) &&
    times.length > 0 &&
    times.every((time) => parseTimeOfDay(time) !== null)
  );
}

/** 校验 interval 调度（旧类型）：every >=1 整数 + 合法单位 */
function isValidInterval(schedule: Partial<ScheduledTaskSchedule>): boolean {
  return (
    Number.isInteger(schedule.every) &&
    (schedule.every ?? 0) >= 1 &&
    INTERVAL_UNITS.includes(schedule.unit as ScheduleUnit)
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
    case "recurrence":
      return isValidRecurrence(candidate);
    case "dates":
      return isValidDates(candidate);
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

/** until 截止日下该日期是否仍在有效期内（含当日；无 until 恒有效） */
function withinUntil(schedule: ScheduledTaskSchedule, dateStr: string): boolean {
  return schedule.until === undefined || dateStr <= schedule.until;
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
  // week 不属于旧 interval（isValidInterval 已排除，这里收窄类型）
  if (unit === "week") {
    return false;
  }
  return now - base >= UNIT_MS[unit] * every;
}

/**
 * 「按日历挑日子」类调度的当日到期判断：
 * 今天匹配（matchesDate）且某个时刻已过、上次运行又早于该时刻 → 到期。
 * 单一 lastRunAt 即可正确驱动一天多时刻（每过一个未运行的时刻即触发一次）。
 */
function isCalendarTimesDue(
  task: ScheduledTask,
  now: number,
  times: { hours: number; minutes: number }[],
): boolean {
  const todayStart = startOfLocalDay(now);
  let last = task.lastRunAt;
  if (last !== null && last < todayStart) {
    last = null; // 昨天及更早的运行不参与今天的判断
  }
  return times.some((time) => {
    const occurrence = todayStart + time.hours * 3_600_000 + time.minutes * 60_000;
    return now >= occurrence && (last === null || last < occurrence);
  });
}

/** daily：今天已过 HH:mm 且上次运行在今天 HH:mm 之前（关机错过会在下次 tick 补跑一次） */
function isDailyDue(task: ScheduledTask, now: number): boolean {
  const time = parseTimeOfDay(task.schedule.time);
  if (!time) {
    return false;
  }
  return isCalendarTimesDue(task, now, [time]);
}

/** monthly：本月（day 超出当月天数取月末）已过 day 日 HH:mm 且上次运行在该时刻之前 */
function isMonthlyDue(task: ScheduledTask, now: number): boolean {
  const time = parseTimeOfDay(task.schedule.time);
  const day = task.schedule.day ?? 0;
  if (!time || !Number.isInteger(day) || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(now);
  const occurrence = new Date(
    d.getFullYear(),
    d.getMonth(),
    Math.min(day, lastDayOfMonth(d.getFullYear(), d.getMonth())),
    time.hours,
    time.minutes,
  ).getTime();
  // 与 daily 不同：occurrence 在本月某日而非今天，lastRunAt 须直接对比（不做「昨日清零」归一化）
  return now >= occurrence && (task.lastRunAt === null || task.lastRunAt < occurrence);
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

/** recurrence：秒/分/时按 interval 语义；天/周/月按日历挑日子 + 当日时刻列表 */
function isRecurrenceDue(task: ScheduledTask, now: number): boolean {
  const schedule = task.schedule;
  if (!isValidRecurrence(schedule)) {
    return false;
  }
  const unit = schedule.unit as ScheduleUnit;
  if (unit === "second" || unit === "minute" || unit === "hour") {
    const base = task.lastRunAt ?? task.createdAt;
    return now - base >= UNIT_MS[unit] * (schedule.every ?? 0);
  }
  const d = new Date(now);
  if (!matchesDate(schedule, d.getFullYear(), d.getMonth(), d.getDate())) {
    return false;
  }
  const times = (schedule.times ?? [])
    .map((time) => parseTimeOfDay(time))
    .filter((time): time is { hours: number; minutes: number } => time !== null);
  return isCalendarTimesDue(task, now, times);
}

/** dates：今天是选中的日期之一，且某个时刻已过而未运行 */
function isDatesDue(task: ScheduledTask, now: number): boolean {
  const schedule = task.schedule;
  if (!isValidDates(schedule)) {
    return false;
  }
  const d = new Date(now);
  if (!matchesDate(schedule, d.getFullYear(), d.getMonth(), d.getDate())) {
    return false;
  }
  const times = (schedule.times ?? [])
    .map((time) => parseTimeOfDay(time))
    .filter((time): time is { hours: number; minutes: number } => time !== null);
  return isCalendarTimesDue(task, now, times);
}

/**
 * 任务在 now 时刻是否到期（不含 enabled 判断，调用方先过滤禁用任务）。
 * 进行中的任务由调用方用 runningIds 去重。
 */
export function isTaskDue(task: ScheduledTask, now: number): boolean {
  switch (task.schedule.kind) {
    case "recurrence":
      return isRecurrenceDue(task, now);
    case "dates":
      return isDatesDue(task, now);
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

/**
 * 该日期是否会触发（日历高亮 / 预览共用）：
 * - recurrence 天/周/月：周期对齐 + 周几/月内规则 + until 有效期
 * - recurrence 秒/分/时、window、旧 daily：每天都会触发
 * - dates / 旧 monthly / once：按选中日期/几号/at 判断
 * - 旧 interval：依赖 lastRunAt 的连续循环，无法按日历判断，返回 false
 */
export function matchesDate(
  schedule: ScheduledTaskSchedule,
  year: number,
  monthIndex: number,
  day: number,
): boolean {
  const date = new Date(year, monthIndex, day);
  const dateStr = localDateISO(date);
  switch (schedule.kind) {
    case "recurrence": {
      if (!withinUntil(schedule, dateStr)) {
        return false;
      }
      const every = schedule.every ?? 1;
      const unit = schedule.unit;
      if (unit === "day") {
        return (
          Math.floor(startOfLocalDay(date.getTime()) / 86_400_000) % every === 0
        );
      }
      if (unit === "week") {
        if (!(schedule.weekdays ?? []).includes(date.getDay())) {
          return false;
        }
        return weekIndexSinceEpoch(date) % every === 0;
      }
      if (unit === "month") {
        if (monthIndexSinceEpoch(date) % every !== 0) {
          return false;
        }
        const monthlyOn = schedule.monthlyOn as MonthlyPattern;
        if (monthlyOn.mode === "day") {
          return Math.min(monthlyOn.day, lastDayOfMonth(year, monthIndex)) === day;
        }
        return nthWeekdayOfMonth(year, monthIndex, monthlyOn.nth, monthlyOn.weekday) === day;
      }
      return true; // 秒/分/时：每天都可能有触发
    }
    case "dates":
      return (schedule.dates ?? []).includes(dateStr);
    case "daily":
      return true;
    case "monthly":
      return Math.min(schedule.day ?? 0, lastDayOfMonth(year, monthIndex)) === day;
    case "once": {
      const at = schedule.at ?? 0;
      if (at <= 0) {
        return false;
      }
      const d = new Date(at);
      return localDateISO(d) === dateStr;
    }
    case "window":
      return true;
    default:
      return false;
  }
}

/**
 * 预览自 from（ms，不含）起的下 count 次运行时间（本地时区）：
 * - interval / recurrence 秒分时：按 from + k×间隔 估算（实际以 lastRunAt 推进，预览近似）
 * - 按日历挑日子的类型：逐天扫描（上限 400 天），每天给出全部未来时刻
 * - once：仅 at > from 时一次
 */
export function nextOccurrences(
  schedule: ScheduledTaskSchedule,
  from: number,
  count: number,
): number[] {
  if (count <= 0) {
    return [];
  }
  const result: number[] = [];
  const stepMs =
    schedule.kind === "interval" ||
    (schedule.kind === "recurrence" &&
      (schedule.unit === "second" || schedule.unit === "minute" || schedule.unit === "hour"))
      ? UNIT_MS[(schedule.unit as Exclude<ScheduleUnit, "week" | "month">) ?? "minute"] *
        (schedule.every ?? 1)
      : 0;
  if (stepMs > 0) {
    for (let k = 1; k <= count; k++) {
      result.push(from + k * stepMs);
    }
    return result;
  }
  if (schedule.kind === "once") {
    return (schedule.at ?? 0) > from ? [schedule.at as number] : [];
  }
  const maxDays = 400;
  const cursor = new Date(from);
  for (let i = 0; i < maxDays && result.length < count; i++) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const d = cursor.getDate();
    if (matchesDate(schedule, y, m, d)) {
      const todayStart = new Date(y, m, d).getTime();
      const times: number[] = [];
      if (schedule.kind === "window") {
        const start = parseTimeOfDay(schedule.startTime)!;
        const end = parseTimeOfDay(schedule.endTime)!;
        const startMinutes = start.hours * 60 + start.minutes;
        const endMinutes = end.hours * 60 + end.minutes;
        const every = schedule.everyMinutes ?? 1;
        for (let minutes = startMinutes; minutes <= endMinutes; minutes += every) {
          times.push(todayStart + minutes * 60_000);
        }
      } else {
        const list =
          schedule.kind === "recurrence" || schedule.kind === "dates"
            ? (schedule.times ?? [])
            : [schedule.time ?? ""];
        for (const time of list) {
          const parsed = parseTimeOfDay(time);
          if (parsed) {
            times.push(todayStart + (parsed.hours * 60 + parsed.minutes) * 60_000);
          }
        }
        times.sort((a, b) => a - b);
      }
      for (const ts of times) {
        if (ts > from) {
          result.push(ts);
          if (result.length >= count) {
            break;
          }
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

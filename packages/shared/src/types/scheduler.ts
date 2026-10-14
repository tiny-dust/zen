/** 调度单位（interval / recurrence 类任务的循环周期单位） */
export type ScheduleUnit = "second" | "minute" | "hour" | "day" | "week" | "month";

/**
 * 月内规则（recurrence 且 unit=month）：
 * - day：每月 X 号（当月不足该日取月末，如 31 → 2 月 28/29 日）
 * - nthWeekday：每月第 N 个周几（如第 2 个周二；当月不足则不触发）
 */
export type MonthlyPattern =
  | { mode: "day"; day: number }
  | { mode: "nthWeekday"; nth: number; weekday: number };

/**
 * 定时任务调度：
 * - recurrence：统一重复规则（RRULE-lite）。每 N 个单位（秒/分/时/天/周/月）循环；
 *   周→按 weekdays 多选周几，月→按 monthlyOn 指定几号或第 N 个周几；
 *   天/周/月在 times 里的一天多个触发时刻；until 为截止日（含当日，本地时区）。
 *   表达力覆盖旧 interval / daily / monthly（编辑旧任务时前向迁移）。
 * - dates：日历多选的任意指定日期 × 多个时刻（每年不规则的那几天跑）
 * - interval：每 N 个单位循环（秒/分/时/天/月）——旧类型，兼容存量数据
 * - daily：每天固定时刻——旧类型，兼容存量数据
 * - monthly：每月几号固定时刻——旧类型，兼容存量数据
 * - once：指定日期时间执行一次（触发后自动停用）
 * - window：每天指定时间范围内每 N 分钟循环
 */
export interface ScheduledTaskSchedule {
  kind:
    | "recurrence"
    | "dates"
    | "interval"
    | "daily"
    | "monthly"
    | "once"
    | "window";
  /** recurrence / interval：循环间隔数值（>=1） */
  every?: number;
  /** recurrence / interval：循环单位 */
  unit?: ScheduleUnit;
  /** recurrence 且 unit=week：选中的星期几（0=周日 … 6=周六），空数组非法 */
  weekdays?: number[];
  /** recurrence 且 unit=month：月内规则 */
  monthlyOn?: MonthlyPattern;
  /** recurrence（天/周/月）/ dates：一天内的触发时刻列表 "HH:mm"（本地时区，非空） */
  times?: string[];
  /** recurrence：截止日 "YYYY-MM-DD"（含当日），缺省永不结束 */
  until?: string;
  /** dates：选中的日期列表 "YYYY-MM-DD"（非空） */
  dates?: string[];
  /** daily / monthly：触发时刻 "HH:mm"（本地时区，24 小时制）——旧类型 */
  time?: string;
  /** monthly：每月几号（1-31）——旧类型 */
  day?: number;
  /** once：触发时间戳（ms，本地时区） */
  at?: number;
  /** window：每日范围起点 "HH:mm" */
  startTime?: string;
  /** window：每日范围终点 "HH:mm"（须晚于起点，不支持跨零点） */
  endTime?: string;
  /** window：范围内循环间隔分钟数（>=1） */
  everyMinutes?: number;
}

/** 定时任务：到点自动在目标工作区新建会话并运行 agent */
export interface ScheduledTask {
  id: string;
  name: string;
  /** 到点发给 agent 的指令 */
  prompt: string;
  schedule: ScheduledTaskSchedule;
  enabled: boolean;
  /** 目标工作区目录；null = 公共区（无项目会话） */
  workspacePath: string | null;
  lastRunAt: number | null;
  /** 最近一次运行结果摘要（助手回复截断或错误信息） */
  lastResult: string | null;
  /** 最近一次运行是否成功；null = 从未运行 */
  lastRunOk: boolean | null;
  createdAt: number;
  updatedAt: number;
}

/** 新建/编辑入参（渲染层 → 主进程；边界处须为纯对象） */
export interface ScheduledTaskInput {
  name: string;
  prompt: string;
  schedule: ScheduledTaskSchedule;
  enabled?: boolean;
  workspacePath: string | null;
}

/** 运行事件推送（scheduler:run-event）：started → done / error */
export interface ScheduledTaskRunEvent {
  taskId: string;
  state: "started" | "done" | "error";
  /** 本次运行新建的会话 id */
  sessionId?: string;
  /** done/error 时的结果摘要 */
  summary?: string;
}

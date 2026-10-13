/** 调度单位（interval 类任务的循环周期单位） */
export type ScheduleUnit = "second" | "minute" | "hour" | "day" | "month";

/**
 * 定时任务调度：
 * - interval：每 N 个单位循环（秒/分/时/天/月）
 * - daily：每天固定时刻
 * - monthly：每月几号固定时刻（当月不足该日取当月最后一天，如 31 → 2 月 28/29 日）
 * - once：指定日期时间执行一次（触发后自动停用）
 * - window：每天指定时间范围内每 N 分钟循环
 * 结构上仍预留 RRULE 扩展位（RFC 5545；当前版本不解析，仅透传保存）。
 */
export interface ScheduledTaskSchedule {
  kind: "interval" | "daily" | "monthly" | "once" | "window";
  /** interval：循环间隔数值（>=1） */
  every?: number;
  /** interval：循环单位 */
  unit?: ScheduleUnit;
  /** daily / monthly：触发时刻 "HH:mm"（本地时区，24 小时制） */
  time?: string;
  /** monthly：每月几号（1-31） */
  day?: number;
  /** once：触发时间戳（ms，本地时区） */
  at?: number;
  /** window：每日范围起点 "HH:mm" */
  startTime?: string;
  /** window：每日范围终点 "HH:mm"（须晚于起点，不支持跨零点） */
  endTime?: string;
  /** window：范围内循环间隔分钟数（>=1） */
  everyMinutes?: number;
  /** RRULE 扩展位（RFC 5545；当前版本不解析，仅透传保存） */
  rrule?: string;
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

/** 定时任务调度：先支持 interval（每 N 分钟）与 daily（每日 HH:mm），结构上预留 RRULE 扩展位 */
export interface ScheduledTaskSchedule {
  kind: "interval" | "daily";
  /** interval：间隔分钟数（>=1） */
  intervalMinutes?: number;
  /** daily：每日触发时刻 "HH:mm"（本地时区，24 小时制） */
  dailyTime?: string;
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

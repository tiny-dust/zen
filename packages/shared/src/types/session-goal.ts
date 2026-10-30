/**
 * 会话目标（Goals 目标模式，会话级设置，持久化在 chat_sessions.goal_json）：
 * 给会话一个可选目标（文本 + token 预算），composer 展示摘要 chip，
 * main 侧在目标 active 时向系统提示词追加一行目标声明。
 */
export type SessionGoalStatus = "active" | "paused" | "blocked" | "complete";

export const SESSION_GOAL_STATUSES: readonly SessionGoalStatus[] = [
  "active",
  "paused",
  "blocked",
  "complete",
];

export interface SessionGoal {
  /** 目标文本（必填；空文本视为无目标） */
  text: string;
  /** 目标状态：active 注入提示词与续跑入口，其余状态仅 UI 展示 */
  status: SessionGoalStatus;
  /** token 预算；null = 未设置。仅 UI 展示与用量对比，不注入提示词 */
  tokenBudget: number | null;
  /** 达到单轮步数上限时，在本机自动续跑；缺省关闭。 */
  autoContinue?: boolean;
  /** 本机目标提醒间隔（小时）；缺省关闭，应用运行时生效。 */
  reminderIntervalHours?: number;
}

/** 目标未知/缺省状态按 active 处理（有文本就有目标，默认进行中） */
export function isSessionGoalStatus(value: unknown): value is SessionGoalStatus {
  return SESSION_GOAL_STATUSES.includes(value as SessionGoalStatus);
}

/**
 * 目标载荷归一化（IPC 边界与 goal_json 解析共用）：
 * 文本为空 / 非对象 / 非法结构一律返回 null（视为无目标）；
 * 非法状态归一化为 active，非法预算归一化为 null。
 */
export function normalizeSessionGoal(value: unknown): SessionGoal | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) {
    return null;
  }
  const status = isSessionGoalStatus(raw.status) ? raw.status : "active";
  const budget = raw.tokenBudget;
  const tokenBudget =
    typeof budget === "number" && Number.isFinite(budget) && budget > 0
      ? Math.round(budget)
      : null;
  return {
    text,
    status,
    tokenBudget,
    ...(raw.autoContinue === true ? { autoContinue: true } : {}),
    ...(typeof raw.reminderIntervalHours === "number" &&
    Number.isInteger(raw.reminderIntervalHours) &&
    raw.reminderIntervalHours >= 1 &&
    raw.reminderIntervalHours <= 168
      ? { reminderIntervalHours: raw.reminderIntervalHours }
      : {}),
  };
}

import type { PermissionMode } from "./agent-settings";

/**
 * 会话模式（会话级设置，持久化在 chat_sessions.mode）：
 * - interactive：互动模式（默认，现状）
 * - plan：计划模式——先产出计划清单，等待用户批准后再执行
 * - autopilot：自动模式——减少确认，尽可能自主完成
 */
export type SessionMode = "interactive" | "plan" | "autopilot";

export const SESSION_MODES: readonly SessionMode[] = [
  "interactive",
  "plan",
  "autopilot",
];

export const DEFAULT_SESSION_MODE: SessionMode = "interactive";

/** 未知/缺省值归一化为 interactive（旧库无 mode 列、历史数据兼容） */
export function normalizeSessionMode(value: unknown): SessionMode {
  return SESSION_MODES.includes(value as SessionMode)
    ? (value as SessionMode)
    : DEFAULT_SESSION_MODE;
}

/**
 * 计划模式的批准消息（协议常量，不走 i18n）：
 * 用户以这条消息批准计划，main 侧识别后把会话切回 interactive 并继续执行。
 * 用户手打「批准执行」开头的内容同样视为批准（带补充说明的批准）。
 */
export const PLAN_APPROVAL_MESSAGE = "批准执行";

/** 权限模式展示名（模式指令文案里引用，三端共用） */
export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  default: "默认权限",
  smart: "智能权限",
  full: "完全访问权限",
};

/**
 * 运行时异常上报（异常中心）：主进程 uncaught/unhandled 与渲染层 error/
 * unhandledrejection 统一收集到 ~/.zen/error-reports.json，按消息+栈首帧去重
 * 累计次数；异常中心面板列出、本地启发式分析是否软件相关，软件相关条目
 * 可一键进入修复会话。
 */

export type ErrorReportSource = "main" | "renderer";

/** 采集入口：uncaughtException / unhandledRejection / 渲染层 window-error / Vue errorHandler / 渲染进程崩溃 */
export type ErrorReportKind =
  | "uncaught"
  | "unhandled"
  | "window-error"
  | "vue"
  | "resource-error"
  | "render-process-gone";

export interface ErrorReportRecord {
  id: string;
  source: ErrorReportSource;
  kind: ErrorReportKind;
  /** 错误消息（截断到 500 字符） */
  message: string;
  /** 错误堆栈（截断到 4000 字符） */
  stack?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  /** 相同错误去重后的累计出现次数 */
  count: number;
  appVersion?: string;
  platform?: string;
}

/** 本地启发式分析结果：是否与软件（Zen 自身代码）相关 */
export interface ErrorReportAnalysis {
  softwareRelated: boolean;
  confidence: "high" | "low";
  /** 人可读的判定理由（中文） */
  reason: string;
}

/** errors:report 上报载荷（渲染层 → 主进程） */
export interface ErrorReportPayload {
  kind: ErrorReportKind;
  message: string;
  stack?: string;
}

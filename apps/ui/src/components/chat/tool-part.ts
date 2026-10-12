import {
  AppWindow,
  Bot,
  Camera,
  FilePen,
  FileSearch,
  FileText,
  FoldVertical,
  FolderOpen,
  Gauge,
  Globe,
  HelpCircle,
  Hourglass,
  Inbox,
  ListTodo,
  MousePointerClick,
  Plug,
  ScanSearch,
  ScanText,
  Sparkles,
  SquareCode,
  SquareTerminal,
  Terminal,
  TextCursorInput,
  Wrench,
} from "@lucide/vue";
import type { Component } from "vue";

import { i18n } from "@/locales";

import type { ChatMessagePart, ToolCallState } from "@zen/shared";

export type ToolPart = Extract<ChatMessagePart, { type: "tool" }>;

export interface ToolTarget {
  kind: "file" | "dir" | "text";
  text: string;
}

export interface ToolDisplay {
  icon: Component;
  label: string;
  target?: ToolTarget;
}

/** 从工具入参里按优先级取第一个非空字符串 */
function argText(args: unknown, keys: string[]): string {
  if (typeof args !== "object" || args === null) {
    return "";
  }
  const record = args as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** 工具的展示形态：图标、动作名与高亮目标（文件可点击定位右栏） */
export function toolDisplay(toolName: string, args: unknown): ToolDisplay {
  switch (toolName) {
    case "runTerminal":
      return {
        icon: SquareTerminal,
        label: i18n.global.t("chat.tool.runTerminal"),
        target: { kind: "text", text: argText(args, ["command"]) },
      };
    case "writeFile":
      return {
        icon: FilePen,
        label: i18n.global.t("chat.tool.writeFile"),
        target: { kind: "file", text: argText(args, ["path", "file_path"]) },
      };
    case "editFile":
      return {
        icon: FilePen,
        label: i18n.global.t("chat.tool.editFile"),
        target: { kind: "file", text: argText(args, ["path", "file_path"]) },
      };
    case "readFile":
      return {
        icon: FileText,
        label: i18n.global.t("chat.tool.readFile"),
        target: { kind: "file", text: argText(args, ["path", "file_path"]) },
      };
    case "listDir":
      return {
        icon: FolderOpen,
        label: i18n.global.t("chat.tool.listDir"),
        target: { kind: "dir", text: argText(args, ["path", "dir"]) || "." },
      };
    case "searchFiles":
      return {
        icon: FileSearch,
        label: i18n.global.t("chat.tool.searchFiles"),
        target: { kind: "text", text: argText(args, ["pattern", "query"]) },
      };
    case "webSearch":
      return {
        icon: Globe,
        label: i18n.global.t("chat.tool.webSearch"),
        target: { kind: "text", text: argText(args, ["query", "search"]) },
      };
    // 内置浏览器工具（impeccable live 走查等会话）
    case "browserStatus":
      return { icon: AppWindow, label: i18n.global.t("chat.tool.browserStatus") };
    case "browserOpen":
      return {
        icon: Globe,
        label: i18n.global.t("chat.tool.browserOpen"),
        target: { kind: "text", text: argText(args, ["url"]) },
      };
    case "browserSnapshot":
      return { icon: ScanText, label: i18n.global.t("chat.tool.browserSnapshot") };
    case "browserExtract":
      return { icon: ScanSearch, label: i18n.global.t("chat.tool.browserExtract") };
    case "browserClick":
      return {
        icon: MousePointerClick,
        label: i18n.global.t("chat.tool.browserClick"),
        target: { kind: "text", text: argText(args, ["selector"]) },
      };
    case "browserType":
      return {
        icon: TextCursorInput,
        label: i18n.global.t("chat.tool.browserType"),
        target: { kind: "text", text: argText(args, ["selector"]) },
      };
    case "browserConsole":
      return { icon: Terminal, label: i18n.global.t("chat.tool.browserConsole") };
    case "browserPerformance":
      return { icon: Gauge, label: i18n.global.t("chat.tool.browserPerformance") };
    case "browserScreenshot":
      return { icon: Camera, label: i18n.global.t("chat.tool.browserScreenshot") };
    case "browserEvaluate":
      return {
        icon: SquareCode,
        label: i18n.global.t("chat.tool.browserEvaluate"),
        target: { kind: "text", text: argText(args, ["expression"]) },
      };
    case "loadSkill":
      return {
        icon: Sparkles,
        label: i18n.global.t("chat.tool.loadSkill"),
        target: { kind: "text", text: argText(args, ["skillId", "skill_id"]) },
      };
    case "updateTasks":
      return { icon: ListTodo, label: i18n.global.t("chat.tool.updateTasks") };
    case "askUser":
      return { icon: HelpCircle, label: i18n.global.t("chat.tool.askUser") };
    case "contextCompact":
      // 时间线由 ContextCompactCard 专用渲染（不走 ToolCallRow）；此处仅兜底图标文案
      return { icon: FoldVertical, label: i18n.global.t("chat.tool.contextCompact") };
    // 多 Agent 协作工具（multi-agent buildTools）
    case "spawnAgent":
      return { icon: Bot, label: i18n.global.t("chat.tool.spawnAgent") };
    case "listAgents":
      return { icon: ListTodo, label: i18n.global.t("chat.tool.listAgents") };
    case "waitForAgents":
      return { icon: Hourglass, label: i18n.global.t("chat.tool.waitForAgents") };
    case "collectAgentResults":
      return { icon: Inbox, label: i18n.global.t("chat.tool.collectAgentResults") };
    default:
      if (toolName.startsWith("mcp.")) {
        return { icon: Plug, label: i18n.global.t("chat.tool.mcpTool", { name: toolName.slice(4) }) };
      }
      // 展示统一中文：未映射的工具名是内部标识符，不直接外显
      return { icon: Wrench, label: i18n.global.t("chat.tool.genericTool") };
  }
}

/** 工具状态词：新 tool part 与旧 role=tool 卡片共用 */
export function toolStateLabel(state: ToolCallState | undefined, percent?: number): string {
  const { t } = i18n.global;
  switch (state) {
    case "input-streaming":
      return t("chat.tool.state.preparing");
    case "awaiting-approval":
      return t("chat.tool.state.awaitingApproval");
    case "running":
      return percent == null ? t("chat.tool.state.running") : `${Math.round(percent)}%`;
    case "ok":
      return t("chat.tool.state.ok");
    case "denied":
      return t("chat.tool.state.denied");
    case "error":
      return t("chat.tool.state.error");
    case "cancelled":
      return t("chat.tool.state.cancelled");
    case "interrupted":
      return t("chat.tool.state.interrupted");
    default:
      return t("chat.tool.state.unknown");
  }
}

/** 状态旁的说明文案：过程用 message，终态用原因/摘要 */
export function toolStatusLine(input: {
  state?: ToolCallState;
  message?: string;
  error?: string;
  summary?: string;
}): string {
  const { state, message, error, summary } = input;
  const { t } = i18n.global;
  if (state === "input-streaming") {
    return message || t("chat.tool.status.preparing");
  }
  if (state === "awaiting-approval") {
    return message || t("chat.tool.status.awaitingApproval");
  }
  if (state === "running") {
    return message || t("chat.tool.status.running");
  }
  if (state === "cancelled") {
    return error || message || t("chat.tool.status.cancelled");
  }
  if (state === "interrupted") {
    return error || message || t("chat.tool.status.interrupted");
  }
  return error || summary || (state === "ok" ? t("chat.tool.status.ok") : t("chat.tool.status.notRun"));
}

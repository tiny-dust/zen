import {
  Bot,
  FilePen,
  FileSearch,
  FileText,
  FoldVertical,
  FolderOpen,
  Globe,
  HelpCircle,
  Hourglass,
  Inbox,
  ListTodo,
  Plug,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "@lucide/vue";
import type { Component } from "vue";

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
        label: "执行终端",
        target: { kind: "text", text: argText(args, ["command"]) },
      };
    case "writeFile":
      return {
        icon: FilePen,
        label: "写入文件",
        target: { kind: "file", text: argText(args, ["path", "file_path"]) },
      };
    case "editFile":
      return {
        icon: FilePen,
        label: "编辑文件",
        target: { kind: "file", text: argText(args, ["path", "file_path"]) },
      };
    case "readFile":
      return {
        icon: FileText,
        label: "读取文件",
        target: { kind: "file", text: argText(args, ["path", "file_path"]) },
      };
    case "listDir":
      return {
        icon: FolderOpen,
        label: "浏览目录",
        target: { kind: "dir", text: argText(args, ["path", "dir"]) || "." },
      };
    case "searchFiles":
      return {
        icon: FileSearch,
        label: "搜索文件",
        target: { kind: "text", text: argText(args, ["pattern", "query"]) },
      };
    case "webSearch":
      return {
        icon: Globe,
        label: "网络搜索",
        target: { kind: "text", text: argText(args, ["query", "search"]) },
      };
    case "loadSkill":
      return {
        icon: Sparkles,
        label: "加载技能",
        target: { kind: "text", text: argText(args, ["skillId", "skill_id"]) },
      };
    case "updateTasks":
      return { icon: ListTodo, label: "更新任务清单" };
    case "askUser":
      return { icon: HelpCircle, label: "询问用户" };
    case "contextCompact":
      // 渲染层自建卡：上下文压缩摘要（output 为折叠后的会话摘要全文）
      return { icon: FoldVertical, label: "上下文压缩" };
    // 多 Agent 协作工具（multi-agent buildTools）
    case "spawnAgent":
      return { icon: Bot, label: "派发子任务" };
    case "listAgents":
      return { icon: ListTodo, label: "查看子任务" };
    case "waitForAgents":
      return { icon: Hourglass, label: "等待子任务" };
    case "collectAgentResults":
      return { icon: Inbox, label: "汇总子任务结果" };
    default:
      if (toolName.startsWith("mcp.")) {
        return { icon: Plug, label: `MCP · ${toolName.slice(4)}` };
      }
      // 展示统一中文：未映射的工具名是内部标识符，不直接外显
      return { icon: Wrench, label: "调用工具" };
  }
}

/** 工具状态词：新 tool part 与旧 role=tool 卡片共用 */
export function toolStateLabel(state: ToolCallState | undefined, percent?: number): string {
  switch (state) {
    case "input-streaming":
      return "准备参数";
    case "awaiting-approval":
      return "待审批";
    case "running":
      return percent == null ? "执行中" : `${Math.round(percent)}%`;
    case "ok":
      return "完成";
    case "denied":
      return "已拒绝";
    case "error":
      return "失败";
    case "cancelled":
      return "已取消";
    case "interrupted":
      return "已中断";
    default:
      return "未知";
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
  if (state === "input-streaming") {
    return message || "正在准备参数";
  }
  if (state === "awaiting-approval") {
    return message || "等待审批";
  }
  if (state === "running") {
    return message || "正在调用工具";
  }
  if (state === "cancelled") {
    return error || message || "已取消，未完成";
  }
  if (state === "interrupted") {
    return error || message || "已中断，未完成";
  }
  return error || summary || (state === "ok" ? "已完成" : "未执行");
}

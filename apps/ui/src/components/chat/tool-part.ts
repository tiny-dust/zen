import {
  FilePen,
  FileSearch,
  FileText,
  FolderOpen,
  Globe,
  HelpCircle,
  ListTodo,
  Plug,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "@lucide/vue";
import type { Component } from "vue";

import type { ChatMessagePart } from "@zen/shared";

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
    default:
      if (toolName.startsWith("mcp.")) {
        return { icon: Plug, label: `MCP · ${toolName.slice(4)}` };
      }
      return { icon: Wrench, label: toolName };
  }
}

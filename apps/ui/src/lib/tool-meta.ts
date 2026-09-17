import {
  Blocks,
  BookMarked,
  FilePen,
  FilePlus,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  ListChecks,
  MessageCircleQuestion,
  Plug,
  Search,
  Terminal,
  Wrench,
} from "@lucide/vue";

import type { FunctionalComponent } from "vue";

export interface ToolIconSpec {
  icon: FunctionalComponent;
  /** 强调色 class（仅图标） */
  cls: string;
  /** 展示名 */
  label: string;
}

const spec = (
  icon: FunctionalComponent,
  cls: string,
  label: string,
): ToolIconSpec => ({ icon, cls, label });

const BY_NAME: Record<string, ToolIconSpec> = {
  readFile: spec(FileText, "text-[var(--color-mut)]", "读取文件"),
  writeFile: spec(FilePlus, "text-[var(--color-add)]", "写入文件"),
  editFile: spec(FilePen, "text-[var(--color-accent)]", "编辑文件"),
  listDir: spec(FolderOpen, "text-[var(--color-mut)]", "列出目录"),
  searchFiles: spec(Search, "text-[var(--color-mut)]", "搜索文件"),
  runTerminal: spec(Terminal, "text-[var(--color-accent-2)]", "终端命令"),
  webSearch: spec(Globe, "text-[var(--color-link)]", "网络搜索"),
  updateTasks: spec(ListChecks, "text-[var(--color-accent)]", "任务清单"),
  askUser: spec(MessageCircleQuestion, "text-[var(--color-accent-2)]", "向用户提问"),
  loadSkill: spec(BookMarked, "text-[var(--color-mut)]", "加载技能"),
};

/** 按工具名解析图标与中文标签；MCP/git 等走前缀兜底 */
export function toolIconSpec(toolName: string): ToolIconSpec {
  const exact = BY_NAME[toolName];
  if (exact) {
    return exact;
  }
  if (toolName.startsWith("mcp.")) {
    const parts = toolName.split(".");
    return spec(Plug, "text-[var(--color-mut)]", parts.slice(1).join(".") || "MCP 工具");
  }
  if (toolName.startsWith("git")) {
    return spec(GitBranch, "text-[var(--color-accent-2)]", toolName);
  }
  if (toolName.startsWith("browser")) {
    return spec(Globe, "text-[var(--color-link)]", toolName);
  }
  if (toolName.startsWith("fs.")) {
    return spec(Blocks, "text-[var(--color-mut)]", toolName);
  }
  return spec(Wrench, "text-[var(--color-mut)]", toolName);
}

/** 工具摘要：优先用事件 summary，其次从 output/args 提炼一行 */
export function toolSummaryLine(
  summary: string | undefined,
  output: unknown,
  args: unknown,
): string {
  const text = (summary ?? "").trim();
  if (text) {
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  if (typeof output === "string" && output.trim()) {
    const line = output.trim().split("\n")[0] ?? "";
    return line.length > 160 ? `${line.slice(0, 160)}…` : line;
  }
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path : "";
    const query = typeof record.query === "string" ? record.query : "";
    const command = typeof record.command === "string" ? record.command : "";
    const picked = path || query || command;
    if (picked) {
      return picked.length > 160 ? `${picked.slice(0, 160)}…` : picked;
    }
  }
  return "";
}

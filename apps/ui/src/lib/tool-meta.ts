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

import { parseMcpToolName } from "@zen/shared";

import { i18n } from "@/locales";

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

/** 展示名走 i18n 的规格构造：label 存消息键，取用时再翻译 */
const keyedSpec = (icon: FunctionalComponent, cls: string, labelKey: string): ToolIconSpec => ({
  icon,
  cls,
  get label() {
    return i18n.global.t(labelKey);
  },
});

const BY_NAME: Record<string, ToolIconSpec> = {
  // 动作名与 tool-part.ts / toolDisplay 对齐，避免新旧工具卡状态词不一致
  readFile: keyedSpec(FileText, "text-[var(--color-mut)]", "app.tool.readFile"),
  writeFile: keyedSpec(FilePlus, "text-[var(--color-add)]", "app.tool.writeFile"),
  editFile: keyedSpec(FilePen, "text-[var(--color-accent)]", "app.tool.editFile"),
  listDir: keyedSpec(FolderOpen, "text-[var(--color-mut)]", "app.tool.listDir"),
  searchFiles: keyedSpec(Search, "text-[var(--color-mut)]", "app.tool.searchFiles"),
  runTerminal: keyedSpec(Terminal, "text-[var(--color-accent-2)]", "app.tool.runTerminal"),
  webSearch: keyedSpec(Globe, "text-[var(--color-link)]", "app.tool.webSearch"),
  updateTasks: keyedSpec(ListChecks, "text-[var(--color-accent)]", "app.tool.updateTasks"),
  askUser: keyedSpec(MessageCircleQuestion, "text-[var(--color-accent-2)]", "app.tool.askUser"),
  loadSkill: keyedSpec(BookMarked, "text-[var(--color-mut)]", "app.tool.loadSkill"),
};

/** 按工具名解析图标与中文标签；MCP/git 等走前缀兜底 */
export function toolIconSpec(toolName: string): ToolIconSpec {
  const exact = BY_NAME[toolName];
  if (exact) {
    return exact;
  }
  const mcp = parseMcpToolName(toolName);
  if (mcp) {
    return spec(Plug, "text-[var(--color-mut)]", `${mcp.serverName}.${mcp.toolName}` || i18n.global.t("app.tool.mcpFallback"));
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

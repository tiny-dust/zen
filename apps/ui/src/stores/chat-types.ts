// chat store 的附属类型与纯函数：与 store 分离以控制单文件规模
import type { ChatMessage, ChatTurn, ToolCallState } from "@zen/shared";

export type RunPhase = "thinking" | "answering";

export interface ActiveTool {
  toolCallId: string;
  toolName: string;
  message: string;
  state: ToolCallState;
  percent?: number;
}

export interface ToolHistoryItem {
  id: string;
  toolName: string;
  summary: string;
  ok: boolean;
  output?: unknown;
}

export interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  prompt: string;
  input?: unknown;
}

export interface ComposerAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  isImage: boolean;
}

/** 输入框选中的技能 chip（悬浮展示基本信息，发送时以 /skill: 前缀告知 Agent） */
export interface SelectedSkill {
  name: string;
  description: string;
  dir?: string;
  source?: "builtin" | "user";
}

/** 取用户/助手可发送历史（去掉系统消息与工具消息） */
export function buildHistory(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role as "user" | "assistant",
      content: item.content,
    }));
}

/** 从工具入参里取本地文件路径（仅读写文件类工具） */
export function pathFromToolArgs(toolName: string, args: unknown): string {
  if (toolName !== "readFile" && toolName !== "editFile" && toolName !== "writeFile") {
    return "";
  }
  if (typeof args !== "object" || args === null) {
    return "";
  }
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file_path"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** 压缩历史时保留的最近轮数（不折叠进摘要） */
const KEEP_RECENT_TURNS = 6;
/** 摘要里每条旧消息的截断长度 */
const DIGEST_LINE_LIMIT = 120;

function truncate(text: string, limit: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

export interface CompressOptions {
  /** 当前任务清单（label + done） */
  tasks: Array<{ label: string; done: boolean }>;
  /** 会话中读写过的文件路径 */
  touchedFiles: string[];
  /** 用户上传过的文件名 */
  uploads: string[];
  /** 手动压缩（压缩按钮） */
  force: boolean;
  /** 上下文用量超过阈值 */
  overThreshold: boolean;
}

export interface CompressResult {
  turns: ChatTurn[];
  compressed: boolean;
}

/**
 * 滚动摘要 + 超限双保险：手动触发或上下文用量超阈值时，把旧轮次折叠成
 * 「目标 / 用户要求 / 任务进度 / 变更文件」摘要，只保留最近几轮原文；
 * 短会话或未触发时原样返回。
 */
export function compressHistory(history: ChatTurn[], opts: CompressOptions): CompressResult {
  if (history.length <= KEEP_RECENT_TURNS || (!opts.force && !opts.overThreshold)) {
    return { turns: history, compressed: false };
  }
  const older = history.slice(0, history.length - KEEP_RECENT_TURNS);
  const recent = history.slice(history.length - KEEP_RECENT_TURNS);

  const lines: string[] = [
    "【会话摘要 · 自动压缩】下面是本会话更早对话的整理，之后附最近几轮对话原文。",
  ];
  const firstUser = older.find((item) => item.role === "user");
  if (firstUser) {
    lines.push("", "目标：", truncate(firstUser.content, 200));
  }
  const olderRequests = older
    .filter((item) => item.role === "user" && item !== firstUser)
    .slice(-8);
  if (olderRequests.length) {
    lines.push("", "用户此前的要求：");
    for (const item of olderRequests) {
      lines.push(`- ${truncate(item.content, DIGEST_LINE_LIMIT)}`);
    }
  }
  const lastAssistant = [...older].reverse().find((item) => item.role === "assistant");
  if (lastAssistant) {
    lines.push("", "最近一次结论：", truncate(lastAssistant.content, 200));
  }
  if (opts.tasks.length) {
    lines.push("", "任务进度：");
    for (const task of opts.tasks) {
      lines.push(`- [${task.done ? "x" : " "}] ${task.label}`);
    }
  }
  if (opts.touchedFiles.length) {
    lines.push("", "会话中读写的文件：");
    for (const file of opts.touchedFiles.slice(0, 12)) {
      lines.push(`- ${file}`);
    }
  }
  if (opts.uploads.length) {
    lines.push("", "用户上传的文件：");
    for (const upload of opts.uploads) {
      lines.push(`- ${upload}`);
    }
  }
  lines.push("", "（摘要结束，以下为最近对话原文）");

  const summary: ChatTurn = { role: "user", content: lines.join("\n") };
  return { turns: [summary, ...recent], compressed: true };
}

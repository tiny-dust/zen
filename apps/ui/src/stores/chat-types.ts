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

/** 取用户/助手可发送历史（去掉系统消息与工具消息） */
export function buildHistory(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role as "user" | "assistant",
      content: item.content,
    }));
}

import type { ReasoningEffort } from "./model";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  reasoning?: string;
  reasoningMs?: number;
  toolCallId?: string;
  meta?: Record<string, unknown>;
}

export type ToolRisk = "read" | "write" | "exec" | "network";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: ToolRisk;
}

export interface ToolProgressEvent {
  toolCallId: string;
  toolName: string;
  message: string;
  percent?: number;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AttachmentRef {
  name: string;
  path: string;
}

export interface AgentRunRequest {
  sessionId: string;
  userMessage: string;
  workspaceRoot: string;
  /** 会话归属的工作区；main 据此落库并解析 agent 的工作目录（不信任 renderer 传路径） */
  workspaceId?: string;
  model?: string;
  providerId?: string;
  reasoningEffort?: ReasoningEffort;
  attachments?: AttachmentRef[];
  history?: ChatTurn[];
}

/** 运行级状态，事件流之外的粗粒度快照（UI 状态机与 main 侧一致）。 */
export type AgentRunStatus =
  | "idle"
  | "thinking"
  | "answering"
  | "tool-running"
  | "awaiting-approval"
  | "paused"
  | "error";

export type AgentDoneReason = "stop" | "cancelled" | "error" | "max_steps";

/** 工具调用生命周期在事件流中的展开状态。 */
export type ToolCallState = "input-streaming" | "running" | "ok" | "error" | "denied";

export interface ToolApprovalRequestEvent {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  /** 传给工具的入参（已解析），供审批 UI 展示。 */
  input: unknown;
  reason?: string;
  risk?: ToolRisk;
}

export interface ToolApprovalDecision {
  approvalId: string;
  approved: boolean;
  reason?: string;
}

export type AgentStreamEvent =
  | { type: "delta"; sessionId: string; text: string }
  | { type: "reasoning_delta"; sessionId: string; text: string }
  | { type: "reasoning_end"; sessionId: string; durationMs: number }
  | {
      type: "tool_input_start";
      sessionId: string;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: "tool_start";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | { type: "tool_progress"; sessionId: string; event: ToolProgressEvent }
  | {
      type: "tool_end";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      ok: boolean;
      summary: string;
      output?: unknown;
    }
  | { type: "approval_request"; sessionId: string; request: ToolApprovalRequestEvent }
  | {
      type: "approval_resolved";
      sessionId: string;
      approvalId: string;
      toolCallId: string;
      approved: boolean;
    }
  | { type: "status"; sessionId: string; status: AgentRunStatus }
  | { type: "step_start"; sessionId: string; step: number }
  | { type: "usage"; sessionId: string; inputTokens: number; outputTokens: number }
  | { type: "done"; sessionId: string; reason: AgentDoneReason }
  | { type: "error"; sessionId: string; message: string };

export interface WorkspaceFile {
  path: string;
  name: string;
  isDir: boolean;
}

/** 文件树懒加载：单层目录条目 */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface ReadFileResult {
  content: string;
  size: number;
  truncated: boolean;
}

export const BUILTIN_SKILLS: Array<{ id: string; label: string; description: string }> = [
  { id: "commit-helper", label: "Commit Helper", description: "按仓库规范生成提交信息" },
];

import type { AskUserQuestionEvent } from "./agent-settings";

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
export type ToolCallState =
  | "input-streaming"
  | "running"
  | "awaiting-approval"
  | "ok"
  | "error"
  | "denied"
  | "cancelled"
  | "interrupted";

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
  /** 本会话内对该工具全部放行（避免同类调用逐次确认） */
  always?: boolean;
}

/** 任务清单条目 */
export interface TaskItem {
  id: string;
  label: string;
  done: boolean;
}

/** 一次会话中的一版任务清单（v1 / v2 …） */
export interface TaskListVersion {
  id: string;
  version: number;
  items: TaskItem[];
  createdAt: number;
}

/** 会话参考条目来源：用户上传 / Agent 触碰的项目文件 / 网络搜索 */
export type ReferenceSource = "user" | "project" | "web";

/** websearch 命中的参考链接 */
export interface ReferenceItem {
  id: string;
  title: string;
  url: string;
  snippet?: string;
  source?: ReferenceSource;
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
      /** 与 ToolCallState 对齐：含 cancelled/interrupted，避免事件协议与运行状态不一致 */
      state?: ToolCallState;
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
  | { type: "ask_user"; sessionId: string; question: AskUserQuestionEvent }
  | {
      type: "ask_resolved";
      sessionId: string;
      askId: string;
      toolCallId: string;
      answer: string;
    }
  | { type: "status"; sessionId: string; status: AgentRunStatus }
  | { type: "step_start"; sessionId: string; step: number }
  | { type: "usage"; sessionId: string; inputTokens: number; outputTokens: number }
  | { type: "tasks_updated"; sessionId: string; version: number; items: TaskItem[] }
  | { type: "reference_found"; sessionId: string; reference: ReferenceItem }
  | {
      type: "agent_tree";
      sessionId: string;
      agents: import("./multi-agent").AgentNodeState[];
      concurrency: { limit: number; running: number };
    }
  | {
      type: "agent_status";
      sessionId: string;
      agent: import("./multi-agent").AgentNodeState;
      concurrency: { limit: number; running: number };
    }
  | { type: "done"; sessionId: string; reason: AgentDoneReason }
  | { type: "error"; sessionId: string; message: string };

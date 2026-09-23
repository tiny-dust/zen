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
  /** 运行中输出尾部（发送侧限量保留），供「进程」节实时刷新 */
  outputTail?: string;
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
  /** 多 Agent：该条目由哪个子 Agent 维护（子会话侧信道事件携带，主 Agent 无） */
  agentName?: string;
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
  /** 多 Agent：产生该参考的子 Agent 名（子会话侧信道事件携带，主 Agent 无） */
  agent?: string;
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
  | {
      type: "tasks_updated";
      sessionId: string;
      version: number;
      items: TaskItem[];
      /** 多 Agent：子会话侧信道事件挂到父会话时携带，UI 按 upsert 合并而非整表替换 */
      agentName?: string;
    }
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
  | { type: "done"; sessionId: string; reason: AgentDoneReason; phase?: "insert" }
  | { type: "error"; sessionId: string; message: string }
  /**
   * 插入执行开始：原 run 已暂停（checkpoint 保留），随后的事件流属于插入 run。
   * 渲染层据此切到「插入 run 进行中」语义，插入 run 的 done（phase=insert）
   * 不应被当作整个会话结束。
   */
  | { type: "insert_started"; sessionId: string; text: string }
  /** 插入 run 结束后原 run 从 checkpoint 恢复：渲染层回到正常 running 语义 */
  | { type: "original_resumed"; sessionId: string };

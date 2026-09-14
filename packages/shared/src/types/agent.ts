export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
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

export interface AgentRunRequest {
  sessionId: string;
  userMessage: string;
  workspaceRoot: string;
  model?: string;
  providerId?: string;
  history?: ChatTurn[];
}

export type AgentStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_progress"; event: ToolProgressEvent }
  | { type: "tool_end"; toolCallId: string; ok: boolean; summary: string }
  | { type: "confirm"; id: string; prompt: string }
  | { type: "done"; reason: "stop" | "cancelled" | "error" | "max_steps" }
  | { type: "error"; message: string };

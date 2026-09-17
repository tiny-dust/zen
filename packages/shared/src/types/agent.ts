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
  | { type: "tasks_updated"; sessionId: string; version: number; items: TaskItem[] }
  | { type: "reference_found"; sessionId: string; reference: ReferenceItem }
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

/** git status --porcelain 的文件级变更（X=暂存区，Y=工作区） */
export interface GitFileChange {
  path: string;
  x: string;
  y: string;
  add: number;
  del: number;
  untracked: boolean;
}

export interface GitStatus {
  branch: string;
  files: GitFileChange[];
  /** 待推送：本地领先上游的提交数；无上游分支时缺省 */
  ahead?: number;
  /** 落后远程：本地落后上游的提交数；无上游分支时缺省 */
  behind?: number;
}

export interface GitLogEntry {
  hash: string;
  parents: string[];
  author: string;
  time: number;
  subject: string;
}

/** 单个提交的变更文件（diff-tree name-status + numstat 合并，按首父对比） */
export interface GitCommitFile {
  path: string;
  /** A/M/D/T 等原始状态字母 */
  status: string;
  add: number;
  del: number;
}

/** 单个提交的完整信息（图谱展开详情） */
export interface GitCommitDetail {
  hash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  committer: string;
  committerEmail: string;
  authorTime: number;
  committerTime: number;
  subject: string;
  /** 完整提交信息（含正文） */
  body: string;
  files: GitCommitFile[];
}

/** 分批提交的单批结果；失败批次 hash 为空 */
export interface GitCommitBatch {
  message: string;
  files: string[];
  hash: string;
}

/** 本地/远程分支条目 */
export interface GitBranchInfo {
  name: string;
  current: boolean;
  /** 远程分支的 remote 名，如 origin */
  remote?: string;
}

export interface GitBranches {
  local: GitBranchInfo[];
  remote: GitBranchInfo[];
}

/** 当前分支关联的 PR（无则为 null） */
export interface GitPullRequest {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged" | "draft";
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

/** websearch 命中的参考链接 */
export interface ReferenceItem {
  id: string;
  title: string;
  url: string;
  snippet?: string;
}

export const BUILTIN_SKILLS: Array<{ id: string; label: string; description: string }> = [
  { id: "commit-helper", label: "Commit Helper", description: "按仓库规范生成提交信息" },
];

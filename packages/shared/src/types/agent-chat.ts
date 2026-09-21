import type { ReasoningEffort } from "./model";
import type { AgentDoneReason, AgentRunStatus, AgentStreamEvent, ToolCallState } from "./agent-events";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatRunSummary {
  reason?: AgentDoneReason;
  status?: AgentRunStatus;
  error?: string;
  step?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  startedAt?: number;
  endedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  reasoning?: string;
  reasoningMs?: number;
  toolCallId?: string;
  meta?: Record<string, unknown>;
  /** 按时间顺序的消息分段（思考 / 正文 / 工具调用），持久化在 meta_json.parts */
  parts?: ChatMessagePart[];
}

/** 消息分段：思考块与正文按流式到达顺序交错，工具调用以行为呈现 */
export type ChatMessagePart =
  | { type: "reasoning"; text: string; ms?: number; done?: boolean }
  | { type: "text"; text: string; done?: boolean }
  | {
      type: "tool";
      toolCallId: string;
      toolName: string;
      state: ToolCallState;
      /** 工具入参（供文件名/命令提取与展示） */
      args?: unknown;
      /** 进行中的动作描述（tool_progress 更新） */
      message?: string;
      /** 进度事件提供的百分比（0–100） */
      percent?: number;
      /** 结束后的结果摘要 */
      summary?: string;
      /** 错误或拒绝原因 */
      error?: string;
      output?: unknown;
    };

/** 把流式事件按顺序累积为消息分段（main 落库与 UI 渲染共用）。 */
function findLastPart(
  parts: ChatMessagePart[],
  predicate: (part: ChatMessagePart) => boolean,
): ChatMessagePart | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part && predicate(part)) {
      return part;
    }
  }
  return undefined;
}

export function applyStreamToParts(
  parts: ChatMessagePart[],
  event: Extract<AgentStreamEvent, { type: "delta" | "reasoning_delta" | "reasoning_end" | "tool_input_start" | "tool_start" | "tool_progress" | "tool_end" }>,
): void {
  const tail = parts[parts.length - 1];
  if (event.type === "delta" || event.type === "reasoning_delta") {
    const type = event.type === "delta" ? "text" : "reasoning";
    if (tail?.type === type) {
      tail.text += event.text;
      tail.done = false;
    } else {
      parts.push({ type, text: event.text, done: false });
    }
    return;
  }
  if (event.type === "reasoning_end") {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      if (part?.type === "reasoning") {
        part.ms = event.durationMs;
        part.done = true;
        break;
      }
    }
    return;
  }
  if (event.type === "tool_input_start" || event.type === "tool_start") {
    const inputStreaming = event.type === "tool_input_start";
    const existing = findLastPart(parts, (part) => part.type === "tool" && part.toolCallId === event.toolCallId);
    if (existing?.type === "tool") {
      if (existing.state !== "denied") existing.state = inputStreaming ? "input-streaming" : "running";
      existing.message = inputStreaming ? "准备工具参数" : "正在调用工具";
      if (!inputStreaming) existing.args = event.args;
    } else {
      parts.push({
        type: "tool",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        state: inputStreaming ? "input-streaming" : "running",
        ...(inputStreaming ? {} : { args: event.args }),
        message: inputStreaming ? "准备工具参数" : "正在调用工具",
      });
    }
    return;
  }
  if (event.type === "tool_progress") {
    const part = findLastPart(parts, (item) => item.type === "tool" && item.toolCallId === event.event.toolCallId);
    if (part?.type === "tool" && !["denied", "cancelled", "interrupted", "ok", "error"].includes(part.state)) {
      part.state = "running";
      part.message = event.event.message;
      part.percent = Number.isFinite(event.event.percent) ? Math.max(0, Math.min(100, event.event.percent as number)) : undefined;
    }
    return;
  }
  const part = findLastPart(parts, (item) => item.type === "tool" && item.toolCallId === event.toolCallId);
  if (part?.type === "tool") {
    if (part.state === "denied" && event.state !== "denied") return;
    part.state = event.state ?? (event.ok ? "ok" : "error");
    part.summary = event.summary;
    part.error = part.state === "denied" || !event.ok ? event.summary : undefined;
    part.output = event.output;
  } else {
    parts.push({ type: "tool", toolCallId: event.toolCallId, toolName: event.toolName, state: event.state ?? (event.ok ? "ok" : "error"), summary: event.summary, output: event.output, error: !event.ok ? event.summary : undefined });
  }
}

function isChatRunSummary(value: unknown): value is ChatRunSummary {
  return typeof value === "object" && value !== null && ("reason" in value || "status" in value || "error" in value || "step" in value || "usage" in value || "startedAt" in value || "endedAt" in value);
}

export function getMessageRun(message: ChatMessage): ChatRunSummary | undefined {
  return isChatRunSummary(message.meta?.run) ? (message.meta?.run as ChatRunSummary) : undefined;
}

/** 落库：parts 并入 meta_json，避免改表结构 */
export function encodeChatMessageMeta(
  message: Pick<ChatMessage, "meta" | "parts">,
): Record<string, unknown> | undefined {
  const parts = message.parts?.length ? message.parts : undefined;
  if (!parts) {
    return message.meta;
  }
  return { ...message.meta, parts };
}

/** 读库：meta_json.parts 提升回顶层；run 等留在 meta */
export function decodeChatMessageMeta(metaJson: string | null | undefined): Pick<ChatMessage, "meta" | "parts"> {
  if (!metaJson) {
    return {};
  }
  let meta = JSON.parse(metaJson) as Record<string, unknown>;
  let parts: ChatMessagePart[] | undefined;
  if (meta && Array.isArray(meta.parts)) {
    parts = meta.parts as ChatMessagePart[];
    const { parts: _parts, ...rest } = meta;
    meta = rest;
  }
  return {
    ...(parts?.length ? { parts } : {}),
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
}

/** 空正文但有 run summary 时也要落库 */
export function shouldPersistAssistantMessage(message: ChatMessage): boolean {
  return Boolean(message.content || message.reasoning || message.parts?.length || getMessageRun(message));
}

/** 从历史消息恢复最后一条 assistant 的 run summary */
export function restoreRunSummaryFromMessages(messages: ChatMessage[]): ChatRunSummary | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return getMessageRun(message) ?? null;
    }
  }
  return null;
}

export function applyStreamToMessage(message: ChatMessage, event: AgentStreamEvent, now = Date.now()): void {
  const run = { ...(getMessageRun(message) ?? {}) };
  if (
    event.type === "delta" ||
    event.type === "reasoning_delta" ||
    event.type === "reasoning_end" ||
    event.type === "tool_input_start" ||
    event.type === "tool_start" ||
    event.type === "tool_progress" ||
    event.type === "tool_end"
  ) {
    applyStreamToParts((message.parts ??= []), event);
    if (event.type === "delta") message.content += event.text;
    if (event.type === "reasoning_delta") message.reasoning = `${message.reasoning ?? ""}${event.text}`;
    if (event.type === "reasoning_end") message.reasoningMs = event.durationMs;
  } else if (event.type === "status") {
    run.status = event.status;
  } else if (event.type === "approval_request") {
    const part = message.parts
      ? findLastPart(message.parts, (item) => item.type === "tool" && item.toolCallId === event.request.toolCallId)
      : undefined;
    if (part?.type === "tool" && !["ok", "error", "denied", "cancelled", "interrupted"].includes(part.state)) {
      part.state = "awaiting-approval";
      part.message = "等待审批";
    }
    run.status = "awaiting-approval";
  } else if (event.type === "approval_resolved") {
    const part = message.parts
      ? findLastPart(message.parts, (item) => item.type === "tool" && item.toolCallId === event.toolCallId)
      : undefined;
    if (part?.type === "tool") {
      if (event.approved) {
        // 批准不是完成：等真实 tool_end
        if (part.state === "awaiting-approval" || part.state === "input-streaming") {
          part.state = "running";
          part.message = "已批准，等待执行";
        }
      } else {
        part.state = "denied";
        part.summary = "已拒绝执行";
        part.error = part.error || "用户拒绝了这次工具调用";
      }
    }
  } else if (event.type === "step_start") {
    run.step = event.step;
    run.startedAt ??= now;
  } else if (event.type === "usage") {
    run.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
  } else if (event.type === "error") {
    // 错误优先：后续 done 不得降级为 stop
    run.reason = "error";
    run.error = event.message;
    run.status = "error";
  } else if (event.type === "done") {
    if (run.reason !== "error") run.reason = event.reason;
    run.endedAt = now;
    run.status = run.reason === "error" ? "error" : "idle";
    if (run.reason === "error" && !run.error) {
      run.error = run.error || undefined;
    }
  }
  if (event.type === "done" || event.type === "error") {
    const cancelled = event.type === "done" && event.reason === "cancelled";
    for (const part of message.parts ?? []) {
      if (part.type !== "tool") {
        part.done = true;
        continue;
      }
      if (["input-streaming", "running", "awaiting-approval"].includes(part.state)) {
        part.state = cancelled ? "cancelled" : "interrupted";
        part.message = cancelled ? "已取消" : "已中断";
        part.error = part.error || (cancelled ? "运行已取消，工具未完成" : "运行中断，工具未完成");
      }
    }
  }
  if (Object.keys(run).length) {
    // delta 等高频事件里 run 往往只是原样拷贝；值没变就不重写 meta，
    // 避免渲染层按 meta 追踪的派发计算（分组/汇总）每次都全量重跑
    const current = getMessageRun(message);
    const unchanged =
      current != null &&
      current.reason === run.reason &&
      current.status === run.status &&
      current.error === run.error &&
      current.step === run.step &&
      current.usage?.inputTokens === run.usage?.inputTokens &&
      current.usage?.outputTokens === run.usage?.outputTokens &&
      current.startedAt === run.startedAt &&
      current.endedAt === run.endedAt;
    if (!unchanged) {
      message.meta = { ...(message.meta ?? {}), run };
    }
  }
}

/** 消息流中工具调用卡片的 meta 形状（role=tool） */
export interface ToolCallMessageMeta {
  toolName: string;
  ok: boolean;
  summary?: string;
  output?: unknown;
  args?: unknown;
  state?: ToolCallState;
  message?: string;
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

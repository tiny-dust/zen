/** 会话内挂起的工具审批（tool-approval-request 后等待用户裁决） */
export interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
}

/** askUser 挂起等待（askId → resolver 由 AgentSession 维护） */
export interface PendingAsk {
  askId: string;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
}

/** 整个 run 的步数上限（stopWhen 只管单次 stream 的步数预算） */
export const MAX_RUN_STEPS = 200;

export function uuidLike(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function partText(part: unknown): string {
  const p = part as { text?: string; delta?: string };
  return p.text ?? p.delta ?? "";
}

export function toolNameFromPart(part: unknown): string {
  const p = part as { toolName?: string; toolCall?: { toolName?: string } };
  return p.toolName ?? p.toolCall?.toolName ?? "unknown";
}

export function toolIdFromPart(part: unknown): string {
  const p = part as { id?: string; toolCallId?: string; toolCall?: { toolCallId?: string } };
  return p.id ?? p.toolCallId ?? p.toolCall?.toolCallId ?? "";
}

export function argsFromPart(part: unknown): unknown {
  const p = part as { toolCall?: { input?: unknown; args?: unknown }; input?: unknown };
  return p.toolCall?.input ?? p.toolCall?.args ?? p.input;
}

export function outputFromPart(part: unknown): unknown {
  const p = part as { output?: unknown; result?: unknown };
  return p.output ?? p.result;
}

export function summarizeToolOutput(part: unknown): string {
  const output = outputFromPart(part);
  if (typeof output === "string") {
    return output.length > 120 ? `${output.slice(0, 120)}…` : output;
  }
  if (output && typeof output === "object" && "path" in output) {
    return String((output as { path: unknown }).path);
  }
  if (isFailedToolOutput(output)) {
    return output.output.length > 120 ? `${output.output.slice(0, 120)}…` : output.output;
  }
  return "工具执行完成";
}

export function isFailedToolOutput(value: unknown): value is { ok: false; output: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === false &&
    "output" in value &&
    typeof (value as { output?: unknown }).output === "string"
  );
}

export function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return "Agent 执行失败";
}

/** AI SDK finish-step 的 usage（token 数可能为 undefined/null） */
export function usageFromPart(part: unknown): { inputTokens: number; outputTokens: number } | null {
  const p = part as {
    usage?: { inputTokens?: number | null; outputTokens?: number | null };
    totalUsage?: { inputTokens?: number | null; outputTokens?: number | null };
  };
  // 单步缺字段时回退到 totalUsage，避免把缺失值当 0 上报
  const inputTokens = p.usage?.inputTokens ?? p.totalUsage?.inputTokens ?? null;
  const outputTokens = p.usage?.outputTokens ?? p.totalUsage?.outputTokens ?? null;
  if (inputTokens == null && outputTokens == null) {
    return null;
  }
  return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
}

import type { AgentStreamEvent } from "@zen/shared";
import type { ToolLoopAgent } from "ai";

import { riskForTool } from "./agent-approval";
import type { PendingApproval } from "./agent-parts";
import {
  argsFromPart,
  errorMessage,
  isFailedToolOutput,
  outputFromPart,
  partText,
  summarizeToolOutput,
  toolIdFromPart,
  toolNameFromPart,
  usageFromPart,
} from "./agent-parts";

/** AI SDK fullStream 的元素类型（switch 按 part.type 窄化后可访问各 case 字段） */
export type StreamPart = Awaited<ReturnType<ToolLoopAgent["stream"]>>["fullStream"] extends AsyncIterable<
  infer T
>
  ? T
  : never;

/**
 * 一次 stream 处理中跨 part 的可变状态：
 * step 累计、最后 finishReason、是否有 tool-call、是否请求过审批、流内错误。
 */
export interface StreamPartState {
  step: number;
  finishReason: string | null;
  lastStepHadToolCalls: boolean;
  approvalRequested: boolean;
  /** 流内 error part 的消息（终态判断用，与 catch 到的异常同样处理） */
  streamError: string | null;
}

export interface StreamPartContext {
  sessionId: string;
  emit: (event: AgentStreamEvent) => void;
  /** 尚未 tool_end 的工具（tool-input-start/tool-call 登记，tool-result/tool-error 移除） */
  openTools: Map<string, string>;
  /** 跨 part 状态（由 AgentSession.runStep 持有） */
  state: StreamPartState;
  /** 非 automatic 审批请求时登记挂起（AgentSession 维护 this.pending） */
  setPendingApproval: (pending: PendingApproval) => void;
}

/** AI SDK fullStream 单个 part → 协议事件 */
export function processStreamPart(part: StreamPart, ctx: StreamPartContext): void {
  const { state, emit, sessionId } = ctx;
  switch (part.type) {
    case "start-step":
      state.step += 1;
      state.lastStepHadToolCalls = false;
      emit({ type: "step_start", sessionId, step: state.step });
      break;
    case "finish":
      state.finishReason = (part as { finishReason?: string }).finishReason ?? null;
      break;
    case "finish-step": {
      const usage = usageFromPart(part);
      if (usage) {
        emit({ type: "usage", sessionId, ...usage });
      }
      break;
    }
    case "reasoning-delta":
      emit({
        type: "reasoning_delta",
        sessionId,
        text: partText(part),
      });
      break;
    case "text-delta": {
      const text = partText(part);
      if (text) {
        emit({
          type: "status",
          sessionId,
          status: "answering",
        });
        emit({ type: "delta", sessionId, text });
      }
      break;
    }
    case "tool-input-start":
      ctx.openTools.set(toolIdFromPart(part), toolNameFromPart(part));
      emit({
        type: "tool_input_start",
        sessionId,
        toolCallId: toolIdFromPart(part),
        toolName: toolNameFromPart(part),
      });
      break;
    case "tool-call":
      ctx.openTools.set(toolIdFromPart(part), toolNameFromPart(part));
      state.lastStepHadToolCalls = true;
      emit({
        type: "tool_start",
        sessionId,
        toolCallId: toolIdFromPart(part),
        toolName: toolNameFromPart(part),
        args: argsFromPart(part),
      });
      emit({
        type: "status",
        sessionId,
        status: "tool-running",
      });
      break;
    case "tool-result":
      ctx.openTools.delete(toolIdFromPart(part));
      emit({
        type: "tool_end",
        sessionId,
        toolCallId: toolIdFromPart(part),
        toolName: toolNameFromPart(part),
        ok: !isFailedToolOutput(outputFromPart(part)),
        state: isFailedToolOutput(outputFromPart(part)) ? "error" : "ok",
        summary: summarizeToolOutput(part),
        output: outputFromPart(part),
      });
      break;
    case "tool-error": {
      ctx.openTools.delete(toolIdFromPart(part));
      const error = (part as { error?: unknown }).error;
      const message = errorMessage(error);
      emit({
        type: "tool_end",
        sessionId,
        toolCallId: toolIdFromPart(part),
        toolName: toolNameFromPart(part),
        ok: false,
        state: "error",
        summary: message || "工具执行失败",
        output: message,
      });
      break;
    }
    case "tool-approval-request":
      if (!part.isAutomatic) {
        state.approvalRequested = true;
        ctx.setPendingApproval({
          approvalId: part.approvalId,
          toolCallId: toolIdFromPart(part),
          toolName: toolNameFromPart(part),
        });
        emit({
          type: "approval_request",
          sessionId,
          request: {
            approvalId: part.approvalId,
            toolCallId: toolIdFromPart(part),
            toolName: toolNameFromPart(part),
            input: argsFromPart(part),
            reason: part.reason,
            risk: riskForTool(toolNameFromPart(part)),
          },
        });
        emit({
          type: "status",
          sessionId,
          status: "awaiting-approval",
        });
      }
      break;
    case "tool-approval-response":
      emit({
        type: "approval_resolved",
        sessionId,
        approvalId: part.approvalId,
        toolCallId: toolIdFromPart(part),
        approved: part.approved,
      });
      break;
    case "error":
      state.streamError = errorMessage(part.error);
      emit({
        type: "error",
        sessionId,
        message: state.streamError,
      });
      break;
    default:
      break;
  }
}

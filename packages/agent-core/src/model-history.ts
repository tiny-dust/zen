import type { ModelMessage, ToolApprovalResponse, ToolCallPart, ToolResultPart } from "ai";

/**
 * 跨轮持久化的全量模型消息：messages 含工具调用/结果/审批响应等全部 part，
 * 下一轮回放时前缀与上一轮字节一致，才能命中服务商 prompt 缓存（Codex/MiMo 同思路）；
 * instructions 是 system 前缀增量（压缩摘要/溢出说明），start 时并入 instructions。
 */
export interface PersistedModelHistory {
  messages: ModelMessage[];
  instructions: string | null;
}

/**
 * 持久化桥（desktop 注入 SQLite）：append 只追加尾部消息（与请求前缀同构，
 * 大历史不整段重写）；rewrite 在压缩/裁剪整体重写历史时同步存储。
 * 实现方自行容错（失败不抛出、不影响 run）。
 */
export interface ModelHistoryStore {
  append(messages: ModelMessage[]): void | Promise<void>;
  rewrite(history: PersistedModelHistory): void | Promise<void>;
}

function assistantToolCallIds(message: ModelMessage): string[] {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return [];
  }
  return message.content
    .filter((part): part is ToolCallPart => part.type === "tool-call")
    .map((part) => part.toolCallId);
}

/** tool 消息里已被 tool-result 覆盖的调用 id + 是否含审批响应（审批响应无 toolCallId） */
function toolResolutionOf(message: ModelMessage): { resolvedIds: Set<string>; hasApproval: boolean } {
  if (message.role !== "tool" || typeof message.content === "string") {
    return { resolvedIds: new Set(), hasApproval: false };
  }
  const resolvedIds = new Set<string>();
  let hasApproval = false;
  for (const part of message.content as Array<ToolResultPart | ToolApprovalResponse>) {
    if (part.type === "tool-result") {
      resolvedIds.add(part.toolCallId);
    } else if (part.type === "tool-approval-response") {
      hasApproval = true;
    }
  }
  return { resolvedIds, hasApproval };
}

/**
 * 回放前净化持久化历史：取消/中断可能留下「assistant 工具调用无结果」的悬空尾部，
 * 直接回放会让下一次请求组装抛 MissingToolResultsError。规则：
 * - 工具调用簇完整（全部调用有 tool-result，或含审批响应）→ 原样保留；
 * - 簇不完整（悬空调用且无审批响应）→ 从该 assistant 消息起整体截断
 *   （其后内容多为插入 run 残段，丢弃只影响模型视角，UI 展示不受影响）；
 * - 无前置调用的孤儿 tool 消息 → 丢弃。
 */
export function sanitizePersistedModelHistory(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (!message) {
      index += 1;
      continue;
    }
    if (message.role === "tool") {
      // 孤儿 tool 消息（前面没有带调用的 assistant）：丢弃
      index += 1;
      continue;
    }
    const calls = assistantToolCallIds(message);
    if (calls.length === 0) {
      out.push(message);
      index += 1;
      continue;
    }
    // 收集紧随其后的连续 tool 消息，判定调用簇是否完整
    const pending = new Set(calls);
    let hasApproval = false;
    let end = index + 1;
    let next = messages[end];
    while (next && next.role === "tool") {
      const { resolvedIds, hasApproval: approved } = toolResolutionOf(next);
      for (const id of resolvedIds) {
        pending.delete(id);
      }
      hasApproval = hasApproval || approved;
      end += 1;
      next = messages[end];
    }
    if (pending.size > 0 && !hasApproval) {
      // 悬空调用：从该 assistant 消息起截断，其后内容一并丢弃
      break;
    }
    out.push(message);
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      const clusterMessage = messages[cursor];
      if (clusterMessage) {
        out.push(clusterMessage);
      }
    }
    index = end;
  }
  return out;
}

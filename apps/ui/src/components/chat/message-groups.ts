import { toolDisplay, toolStateLabel } from "@/components/chat/tool-part";
import { toolResultState } from "@/components/chat/tool-result";

import type { ToolPart } from "@/components/chat/tool-part";
import type { ChatMessage, ChatMessagePart, ToolCallMessageMeta, ToolCallState } from "@zen/shared";

export type MessageDisplayPart =
  | (Exclude<ChatMessagePart, { type: "tool" }> & { key: string; index: number })
  | { type: "tools"; key: string; index: number; tools: ToolPart[] };

export type TimelineItem =
  | { type: "message"; key: string; message: ChatMessage }
  | { type: "tools"; key: string; tools: ToolPart[] };

/** 正文或下一轮思考是分组边界，不改动消息本身和原始时间顺序。 */
export function groupMessageParts(parts: ChatMessagePart[]): MessageDisplayPart[] {
  const groups: MessageDisplayPart[] = [];
  parts.forEach((part, index) => {
    if (part.type !== "tool") {
      groups.push({ ...part, index, key: `${part.type}-${index}` });
      return;
    }
    const previous = groups.at(-1);
    if (previous?.type === "tools") {
      previous.tools.push(part);
    } else {
      groups.push({ type: "tools", index, key: `tools-${part.toolCallId}`, tools: [part] });
    }
  });
  return groups;
}

export function legacyToolPart(meta: ToolCallMessageMeta, id: string, content = ""): ToolPart {
  const state = meta.state ?? (meta.ok ? "ok" : "error");
  const failed = ["error", "denied", "cancelled", "interrupted"].includes(state);
  return {
    type: "tool",
    toolCallId: id,
    toolName: meta.toolName,
    state,
    args: meta.args,
    summary: meta.summary || content,
    error: failed ? meta.summary || content : undefined,
    output: meta.output,
    message: meta.message,
    percent: meta.percent,
  };
}

/** 旧版独立工具消息也按连续段汇总，用户消息和通知不会被跨过。 */
export function groupTimelineMessages(messages: ChatMessage[]): TimelineItem[] {
  const groups: TimelineItem[] = [];
  for (const message of messages) {
    const meta = message.meta as Partial<ToolCallMessageMeta> | undefined;
    if (message.role !== "tool" || typeof meta?.toolName !== "string") {
      groups.push({ type: "message", key: message.id, message });
      continue;
    }
    const part = legacyToolPart(
      { ...meta, toolName: meta.toolName, ok: meta.ok !== false },
      message.toolCallId || message.id,
      message.content,
    );
    const previous = groups.at(-1);
    if (previous?.type === "tools") {
      previous.tools.push(part);
    } else {
      groups.push({ type: "tools", key: message.id, tools: [part] });
    }
  }
  return groups;
}

const STATE_ORDER: ToolCallState[] = [
  "awaiting-approval", "running", "input-streaming", "error", "denied", "cancelled", "interrupted", "ok",
];

export function summarizeTools(tools: ToolPart[]) {
  const actions = new Map<string, number>();
  const states = new Map<ToolCallState, number>();
  for (const tool of tools) {
    const label = toolDisplay(tool.toolName, tool.args).label;
    actions.set(label, (actions.get(label) ?? 0) + 1);
    const state = toolResultState(tool);
    states.set(state, (states.get(state) ?? 0) + 1);
  }
  return {
    label: [...actions].map(([label, count]) => `${label} ${count}`).join(" · "),
    active: tools.some((tool) => tool.state === "running" || tool.state === "input-streaming"),
    states: STATE_ORDER.filter((state) => states.has(state)).map((state) => ({
      state,
      label: `${toolStateLabel(state)} ${states.get(state)}`,
    })),
  };
}

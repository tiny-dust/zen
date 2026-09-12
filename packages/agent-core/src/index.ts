import { delay } from "rattail";

import type { AgentRunRequest, AgentStreamEvent } from "@zen/shared";

const MOCK_REPLY_PREFIX =
  "【Mock Agent】已收到你的消息。后续将接入 AI SDK ToolLoopAgent，完成「改文件 → 跑测试 → commit」闭环。\n\n你刚才说：";

export async function runMockAgent(
  request: AgentRunRequest,
  signal: AbortSignal,
  emit: (event: AgentStreamEvent) => void,
): Promise<void> {
  if (signal.aborted) {
    emit({ type: "done", reason: "cancelled" });
    return;
  }

  const text = `${MOCK_REPLY_PREFIX}${request.userMessage}`;
  for (const char of text) {
    if (signal.aborted) {
      emit({ type: "done", reason: "cancelled" });
      return;
    }
    emit({ type: "delta", text: char });
    await delay(16);
  }

  emit({ type: "done", reason: "stop" });
}

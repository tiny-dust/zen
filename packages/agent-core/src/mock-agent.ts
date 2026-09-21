import type { AgentStreamEvent } from "@zen/shared";

const MOCK_REPLY_PREFIX =
  "【Mock Agent】已收到你的消息。后续将接入 AI SDK ToolLoopAgent，完成「改文件 → 跑测试 → commit」闭环。\n\n你刚才说：";

export async function runMockAgent(
  sessionId: string,
  userMessage: string,
  signal: AbortSignal,
  emit: (event: AgentStreamEvent) => void,
): Promise<void> {
  if (signal.aborted) {
    emit({ type: "done", sessionId, reason: "cancelled" });
    return;
  }

  emit({ type: "status", sessionId, status: "thinking" });
  const text = `${MOCK_REPLY_PREFIX}${userMessage}`;
  for (const char of text) {
    if (signal.aborted) {
      emit({ type: "done", sessionId, reason: "cancelled" });
      return;
    }
    emit({ type: "delta", sessionId, text: char });
    await delayMs(16);
  }

  emit({ type: "done", sessionId, reason: "stop" });
}

async function delayMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

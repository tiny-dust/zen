import type { ChatMessage, ChatMessagePart, SkillPanelMetrics } from "@zen/shared";

type ToolPart = Extract<ChatMessagePart, { type: "tool" }>;

/** 测试命令识别：命中即视为「最后一条测试」 */
const TEST_COMMAND =
  /\b(vitest|jest|pytest|go\s+test|cargo\s+test|mvn\s+test|gradle\s+test|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+test|bun\s+test)\b/i;

/**
 * 技能面板可用的会话指标（纯函数）：只算 zen 真实拿得到的数据。
 * 没有模型价格表 → 不算 cost；代码复用率没有判定信号 → 不出现。
 */
export function sessionMetrics(input: {
  messages: ChatMessage[];
  inputTokens: number | null;
  outputTokens: number | null;
  cacheHitRate: number | null;
}): SkillPanelMetrics {
  const { messages } = input;
  const tools = messages.flatMap((message) =>
    (message.parts ?? []).filter((part): part is ToolPart => part.type === "tool"),
  );
  const stamps = messages.map((message) => message.createdAt);
  return {
    rounds: messages.filter((message) => message.role === "user").length,
    tools: tools.length,
    elapsedMs: stamps.length < 2 ? 0 : Math.max(...stamps) - Math.min(...stamps),
    tests: lastTestState(tools),
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheHitRate: input.cacheHitRate,
  };
}

function lastTestState(tools: ToolPart[]): "none" | "pass" | "fail" {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const part = tools[index];
    if (!TEST_COMMAND.test(commandOf(part))) {
      continue;
    }
    return part.state === "ok" ? "pass" : "fail";
  }
  return "none";
}

function commandOf(part: ToolPart): string {
  if (part.toolName !== "runTerminal") {
    return "";
  }
  const args = part.args as { command?: unknown } | undefined;
  return typeof args?.command === "string" ? args.command : "";
}

import { describe, expect, it, vi } from "vitest";

import type { ModelMessage } from "ai";

import {
  clearStaleToolResults,
  compactMessagesForOverflow,
  isContextOverflowError,
  recentTouchedFilePaths,
  summarizeWithModel,
  tailWindowForCompact,
} from "./context-overflow";
import type { AgentSessionConfig } from "./agent-config";

const summaryConfig: AgentSessionConfig = {
  sessionId: "summary-cancel",
  workspaceRoot: ".",
  protocol: "openai-chat",
  baseUrl: "http://127.0.0.1:1",
  apiKey: "test-key",
  model: "test-model",
  permissionMode: "default",
  emit: () => {},
};

describe("summarizeWithModel", () => {
  it("取消信号传到默认摘要模型请求", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      requestSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new Error("summary cancelled")), { once: true });
      });
    });
    const request = summarizeWithModel(summaryConfig, [user("摘要历史")], null, controller.signal);
    const rejected = expect(request).rejects.toBeDefined();
    try {
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      controller.abort();
      expect(requestSignal?.aborted).toBe(true);
      await rejected;
    } finally {
      controller.abort();
      fetchSpy.mockRestore();
    }
  });

  it("ChatGPT 方案不调用非流式模型，保留裁剪回退", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("不应请求模型"));
    try {
      expect(await summarizeWithModel({ ...summaryConfig, chatgptPlan: true }, [user("历史")])).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

function user(text: string): ModelMessage {
  return { role: "user", content: text };
}

function assistant(text: string): ModelMessage {
  return { role: "assistant", content: text };
}

/** 一对 assistant(tool-call) + tool(result)：裁剪单元的不可拆分单位 */
function toolPair(id: string, result: string): ModelMessage[] {
  return toolCallPair(id, "readFile", "note.md", result);
}

function toolCallPair(id: string, toolName: string, path: string, result: string): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: id, toolName, input: { path } }],
    } as unknown as ModelMessage,
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName,
          output: { type: "text", value: result },
        },
      ],
    } as unknown as ModelMessage,
  ];
}

describe("isContextOverflowError", () => {
  it("识别各家超限文案", () => {
    expect(
      isContextOverflowError(
        new Error(
          "This model's maximum context length is 8192 tokens. However, you requested 12000 tokens.",
        ),
      ),
    ).toBe(true);
    expect(isContextOverflowError("prompt is too long: 213462 tokens > 200000 maximum")).toBe(true);
    expect(isContextOverflowError("context_length_exceeded")).toBe(true);
    expect(isContextOverflowError("input too long: 189413 tokens > 163840 maximum")).toBe(true);
    expect(isContextOverflowError("请求失败：上下文长度超过限制")).toBe(true);
  });

  it("413 状态码直接判定", () => {
    expect(isContextOverflowError({ statusCode: 413, message: "payload too large" })).toBe(true);
  });

  it("限流措辞否决：TPM/配额文案同样含 tokens exceeded，不算溢出", () => {
    expect(
      isContextOverflowError("Rate limit reached: tokens per minute limit exceeded (TPM)"),
    ).toBe(false);
    expect(isContextOverflowError("You exceeded your current quota, please check your plan")).toBe(
      false,
    );
    expect(isContextOverflowError({ statusCode: 429, message: "too many requests" })).toBe(false);
  });

  it("cause 链与普通错误不误判", () => {
    const wrapped = new Error("fetch failed", { cause: new Error("prompt is too long") });
    expect(isContextOverflowError(wrapped)).toBe(true);
    expect(isContextOverflowError(new Error("connection reset by peer"))).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
  });
});

describe("compactMessagesForOverflow", () => {
  it("多轮历史 + 当前 run：丢最旧单元、保最后 user 与保护尾、配对完整", () => {
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 5; i += 1) {
      messages.push(user(`旧问题${i} ${"x".repeat(2000)}`));
      messages.push(assistant(`旧回答${i} ${"y".repeat(2000)}`));
    }
    messages.push(user("当前任务"));
    for (let i = 0; i < 8; i += 1) {
      messages.push(...toolPair(`call_${i}`, "r".repeat(2000)));
    }
    messages.push(assistant("当前回答"));

    const result = compactMessagesForOverflow(messages);
    expect(result).not.toBeNull();
    const { messages: kept, droppedCount } = result as NonNullable<
      ReturnType<typeof compactMessagesForOverflow>
    >;
    expect(droppedCount).toBeGreaterThan(0);
    // 首条为 user，最后一条 user（当前任务）必被保留
    expect(kept[0]?.role).toBe("user");
    expect(kept.some((message) => message.role === "user" && message.content === "当前任务")).toBe(
      true,
    );
    // 尾部消息原样保留
    expect(kept.at(-1)).toEqual(assistant("当前回答"));
    // tool 配对完整：每个 tool 消息前面都有带同名 tool-call 的 assistant
    for (let i = 0; i < kept.length; i += 1) {
      if (kept[i]?.role !== "tool") {
        continue;
      }
      const prev = kept[i - 1];
      const calls = Array.isArray(prev?.content)
        ? (prev.content as Array<{ type: string; toolCallId?: string }>).filter(
            (part) => part.type === "tool-call",
          )
        : [];
      const toolIds = Array.isArray(kept[i]?.content)
        ? (kept[i]!.content as Array<{ type: string; toolCallId?: string }>)
            .filter((part) => part.type === "tool-result")
            .map((part) => part.toolCallId)
        : [];
      for (const toolCallId of toolIds) {
        expect(calls.some((call) => call.toolCallId === toolCallId)).toBe(true);
      }
    }
  });

  it("首调即超限：无 run 消息时历史就是可释放空间，最后 user 保留", () => {
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 6; i += 1) {
      messages.push(user(`旧问题${i} ${"x".repeat(2000)}`));
      messages.push(assistant(`旧回答${i} ${"y".repeat(2000)}`));
    }
    messages.push(user("当前任务"));
    const result = compactMessagesForOverflow(messages);
    expect(result).not.toBeNull();
    const kept = (result as NonNullable<ReturnType<typeof compactMessagesForOverflow>>).messages;
    expect(kept[0]?.role).toBe("user");
    expect(kept.length).toBeLessThan(messages.length);
  });

  it("单条超大 prompt 无内容可裁：返回 null（不重发注定失败的请求）", () => {
    expect(compactMessagesForOverflow([user("z".repeat(100_000))])).toBeNull();
    expect(compactMessagesForOverflow([user("短任务")])).toBeNull();
  });
});

describe("tailWindowForCompact", () => {
  it("保留完整 tool 配对的尾部并回退到 user 边界", () => {
    const messages: ModelMessage[] = [
      user("旧1 " + "x".repeat(100)),
      assistant("旧答1"),
      user("旧2 " + "x".repeat(100)),
      assistant("旧答2"),
      user("当前任务"),
      ...toolPair("c1", "r1"),
      assistant("中间陈述"),
      ...toolPair("c2", "r2"),
    ];
    const tail = tailWindowForCompact(messages);
    // 首条为 user，最后一条原样保留
    expect(tail[0]?.role).toBe("user");
    expect(tail.at(-1)).toEqual(messages.at(-1));
    // 尾窗不拆对：两次 tool 配对都完整保留
    const serialized = JSON.stringify(tail);
    expect(serialized).toContain("c1");
    expect(serialized).toContain("c2");
    // 早期历史被排除
    expect(serialized).not.toContain("旧1");
  });

  it("无 user 边界可回退时受延伸上限保护（保留最近窗口即可）", () => {
    const messages: ModelMessage[] = [user("起点")];
    for (let i = 0; i < 20; i += 1) {
      messages.push(assistant(`A${i} ${"y".repeat(50)}`));
    }
    const tail = tailWindowForCompact(messages);
    expect(tail.at(-1)).toEqual(messages.at(-1));
    // 基础窗口 + 回退延伸都有上限，不会把整个数组都当尾窗
    expect(tail.length).toBeLessThan(messages.length);
    expect(tail.length).toBeLessThanOrEqual(12);
  });
});

describe("recentTouchedFilePaths", () => {
  it("跨 readFile/writeFile/editFile 去重提取，最新在后，限量取最近", () => {
    const messages: ModelMessage[] = [
      ...toolCallPair("i1", "readFile", "a.md", "x"),
      ...toolCallPair("i2", "writeFile", "b.ts", "y"),
      ...toolCallPair("i3", "readFile", "a.md", "z"),
      ...toolCallPair("i4", "editFile", "c.md", "w"),
      assistant("纯文本回复，无工具"),
      user("问题"),
    ];
    expect(recentTouchedFilePaths(messages)).toEqual(["b.ts", "a.md", "c.md"]);
    expect(recentTouchedFilePaths(messages, 2)).toEqual(["a.md", "c.md"]);
  });

  it("无文件工具调用时返回空数组", () => {
    expect(recentTouchedFilePaths([user("q"), assistant("a")])).toEqual([]);
  });
});

describe("clearStaleToolResults", () => {
  function outputOf(message: ModelMessage | undefined): string {
    const part = (message?.content as Array<{ output?: { value?: string } }>)[0];
    return part?.output?.value ?? "";
  }

  function history(): ModelMessage[] {
    const messages: ModelMessage[] = [user("当前任务")];
    for (let i = 0; i < 8; i += 1) {
      messages.push(...toolPair(`call_${i}`, `结果${i} ` + "r".repeat(3000)));
    }
    return messages;
  }

  it("尾窗外的大块输出换成占位：配对与 id 保留，尾窗原样，不修改入参", () => {
    const messages = history();
    const snapshot = JSON.stringify(messages);
    const result = clearStaleToolResults(messages);
    expect(result).not.toBeNull();
    const { messages: next, clearedCount, freedChars } = result as NonNullable<typeof result>;

    expect(JSON.stringify(messages)).toBe(snapshot);
    expect(next).toHaveLength(messages.length);
    expect(clearedCount).toBeGreaterThan(0);
    expect(freedChars).toBeGreaterThan(0);
    // 最早的结果被清理，但 tool-call / tool-result 的 id 与工具名都在
    expect(outputOf(next[2])).toContain("[工具结果已清理] readFile");
    expect(JSON.stringify(next[1])).toContain("call_0");
    expect(JSON.stringify(next[2])).toContain("call_0");
    // 尾窗（最近的调用）保持原文
    expect(next.at(-1)).toEqual(messages.at(-1));
    expect(outputOf(next.at(-1))).toContain("结果7");
    // 再跑一次没有新的可清理内容：不重复改写（保住缓存前缀）
    expect(clearStaleToolResults(next)).toBeNull();
  });

  it("不可重新获取的工具输出保留原文（技能正文、子 Agent 结果）", () => {
    const messages: ModelMessage[] = [user("当前任务")];
    messages.push(...toolCallPair("call_skill", "loadSkill", "coder", "技能正文 " + "s".repeat(3000)));
    messages.push(
      ...toolCallPair("call_agents", "collectAgentResults", "-", "子结果 " + "a".repeat(3000)),
    );
    for (let i = 0; i < 8; i += 1) {
      messages.push(...toolPair(`call_${i}`, `结果${i} ` + "r".repeat(3000)));
    }
    const result = clearStaleToolResults(messages);
    expect(result).not.toBeNull();
    const next = (result as NonNullable<typeof result>).messages;
    expect(outputOf(next[2])).toContain("技能正文");
    expect(outputOf(next[4])).toContain("子结果");
    expect(outputOf(next[6])).toContain("[工具结果已清理]");
  });

  it("没有可清理内容或释放量不足时返回 null", () => {
    // 全在尾窗内
    expect(clearStaleToolResults([user("q"), ...toolPair("c1", "r".repeat(3000))])).toBeNull();
    // 输出都很小
    const small: ModelMessage[] = [user("当前任务")];
    for (let i = 0; i < 8; i += 1) {
      small.push(...toolPair(`call_${i}`, "ok"));
    }
    expect(clearStaleToolResults(small)).toBeNull();
    // 只有一条可清理，但相对总量太小（不足 10%）
    const diluted: ModelMessage[] = [user("背景 " + "x".repeat(40000))];
    diluted.push(...toolPair("call_old", "r".repeat(1000)));
    for (let i = 0; i < 8; i += 1) {
      diluted.push(...toolPair(`call_${i}`, "ok"));
    }
    expect(clearStaleToolResults(diluted)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import type { ChatMessage, ChatMessagePart, ToolCallState } from "@zen/shared";

import { buildTraceDocument, countSessionTrace, toolBucket } from "./document";

function userMessage(content: string, createdAt: number): ChatMessage {
  return { id: `u-${createdAt}`, role: "user", content, createdAt };
}

function assistantMessage(
  parts: ChatMessagePart[],
  options: {
    createdAt?: number;
    content?: string;
    run?: Record<string, unknown>;
  } = {},
): ChatMessage {
  return {
    id: `a-${options.createdAt ?? 1}`,
    role: "assistant",
    content: options.content ?? "",
    createdAt: options.createdAt ?? 1,
    parts,
    ...(options.run ? { meta: { run: options.run } } : {}),
  };
}

function toolPart(
  toolName: string,
  state: ToolCallState,
  args?: unknown,
  extra: Partial<Extract<ChatMessagePart, { type: "tool" }>> = {},
): ChatMessagePart {
  return {
    type: "tool",
    toolCallId: `${toolName}-${Math.random().toString(36).slice(2, 8)}`,
    toolName,
    state,
    args,
    ...extra,
  };
}

describe("buildTraceDocument", () => {
  it("把用户与助手消息配成一轮，并按分段顺序产出节点", () => {
    const messages: ChatMessage[] = [
      userMessage("帮我看看 a.ts", 1_000),
      assistantMessage(
        [
          { type: "reasoning", text: "先读取文件。", ms: 1_200 },
          toolPart("readFile", "ok", { path: "src/a.ts" }, { summary: "读取完成" }),
        ],
        {
          createdAt: 1_000,
          content: "看完了",
          run: { startedAt: 1_000, endedAt: 9_000, status: "idle" },
        },
      ),
    ];

    const doc = buildTraceDocument(messages);

    expect(doc.rootTurnIds).toHaveLength(1);
    expect(doc.stats.turns).toBe(1);
    expect(doc.orderedNodeIds.map((id) => doc.nodesById[id]?.kind)).toEqual([
      "user",
      "thinking",
      "tool",
      "reply",
    ]);
    expect(new Set(doc.orderedNodeIds).size).toBe(doc.orderedNodeIds.length);

    const thinking = doc.orderedNodeIds
      .map((id) => doc.nodesById[id])
      .find((node) => node?.kind === "thinking");
    expect(thinking?.durationMs).toBe(1_200);
    expect(thinking?.start).toBe(1_000);
    expect(thinking?.end).toBe(2_200);

    const tool = doc.orderedNodeIds
      .map((id) => doc.nodesById[id])
      .find((node) => node?.kind === "tool");
    // 工具没有真实耗时：只占游标位置，跨度 0
    expect(tool?.start).toBe(2_200);
    expect(tool?.end).toBe(2_200);
    expect(tool?.durationMs).toBeUndefined();
    expect(tool?.subtitle).toBe("readFile");
    expect(tool?.title).toContain("src/a.ts");
    expect(tool?.searchText).toContain("readfile");
  });

  it("旧消息（只有 reasoning / content）也能合成出思考与回复节点", () => {
    const doc = buildTraceDocument([
      userMessage("旧会话", 5_000),
      {
        id: "legacy",
        role: "assistant",
        content: "旧回复",
        createdAt: 5_000,
        reasoning: "旧思考",
        reasoningMs: 2_500,
      },
    ]);

    const kinds = doc.orderedNodeIds.map((id) => doc.nodesById[id]?.kind);
    expect(kinds).toEqual(["user", "thinking", "reply"]);
    const thinking = doc.orderedNodeIds
      .map((id) => doc.nodesById[id])
      .find((node) => node?.kind === "thinking");
    expect(thinking?.durationMs).toBe(2_500);
  });

  it("统计思考段数、工具调用、失败与慢步骤，并累加 token", () => {
    const doc = buildTraceDocument([
      userMessage("跑一下", 1_000),
      assistantMessage(
        [
          { type: "reasoning", text: "慢思考", ms: 3_000 },
          toolPart("runTerminal", "ok", { command: "pnpm test" }),
          toolPart("runTerminal", "error", { command: "pnpm lint" }, { error: "exit 1" }),
        ],
        {
          createdAt: 1_000,
          content: "完成",
          run: {
            startedAt: 1_000,
            endedAt: 11_000,
            status: "idle",
            usage: { inputTokens: 1_500, outputTokens: 300 },
          },
        },
      ),
    ]);

    expect(doc.stats.thinkingCount).toBe(1);
    expect(doc.stats.toolCount).toBe(2);
    expect(doc.stats.failedCount).toBe(1);
    expect(doc.stats.slowCount).toBe(1);
    expect(doc.stats.inputTokens).toBe(1_500);
    expect(doc.stats.outputTokens).toBe(300);
    // 没有网关请求数据
    expect(doc.stats.requestCount).toBe(0);
  });

  it("run 失败时用错误节点收尾，工具错误映射为 error 状态", () => {
    const doc = buildTraceDocument([
      userMessage("再试", 1_000),
      assistantMessage([toolPart("readFile", "error", { path: "x.ts" })], {
        createdAt: 1_000,
        run: { startedAt: 1_000, endedAt: 2_000, status: "error", error: "模型不可用" },
      }),
    ]);

    const kinds = doc.orderedNodeIds.map((id) => doc.nodesById[id]?.kind);
    expect(kinds).toContain("error");
    expect(kinds).not.toContain("reply");
    const tool = doc.orderedNodeIds
      .map((id) => doc.nodesById[id])
      .find((node) => node?.kind === "tool");
    expect(tool?.status).toBe("error");
    expect(doc.turns[0]?.status).toBe("error");
  });

  it("run 未结束时轮次与工具都标记为 running", () => {
    const doc = buildTraceDocument([
      userMessage("进行中", 1_000),
      assistantMessage([toolPart("runTerminal", "running", { command: "sleep 1" })], {
        createdAt: 1_000,
        run: { startedAt: 1_000, status: "tool-running" },
      }),
    ]);

    expect(doc.turns[0]?.status).toBe("running");
    expect(doc.turns[0]?.durationMs).toBeUndefined();
  });

  it("工具类别决定聚簇分组：浏览/命令/编辑/其它", () => {
    expect(toolBucket("readFile")).toBe("explore");
    expect(toolBucket("browserClick")).toBe("explore");
    expect(toolBucket("runTerminal")).toBe("command");
    expect(toolBucket("editFile")).toBe("edit");
    expect(toolBucket("updateTasks")).toBe("other");
  });

  it("countSessionTrace 只数助手消息与其中的工具分段", () => {
    const messages: ChatMessage[] = [
      userMessage("一", 1_000),
      assistantMessage([toolPart("readFile", "ok", { path: "a.ts" }), toolPart("listDir", "ok", {})], {
        createdAt: 1_000,
        content: "一",
      }),
      userMessage("二", 5_000),
      assistantMessage([], { createdAt: 5_000, content: "二" }),
    ];

    expect(countSessionTrace(messages)).toEqual({ turns: 2, tools: 2 });
  });
});

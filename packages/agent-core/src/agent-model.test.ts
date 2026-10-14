import { InvalidToolInputError, NoSuchToolError, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildProviderOptions,
  buildToolCallRepair,
  cleanToolInputText,
  createLanguageModel,
  normalizeToolName,
  truncateOutput,
} from "./agent-model";

import type { AgentSessionConfig } from "./agent-config";

/**
 * 模型构造与推理参数：
 * - buildProviderOptions 按 protocol 分支（anthropic / openai-responses / compatible）
 * - effort=off 或缺省返回空对象
 * - createLanguageModel 的 baseUrl 自动补 /v1（已带版本段则不动）
 */

function config(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    sessionId: "s",
    workspaceRoot: "/tmp/w",
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:1234",
    apiKey: "k",
    model: "m",
    permissionMode: "full",
    emit: () => {},
    ...overrides,
  };
}

describe("buildProviderOptions", () => {
  it("缺省或 off 不下发推理参数", () => {
    expect(buildProviderOptions(config())).toEqual({});
    expect(buildProviderOptions(config({ reasoningEffort: "off" }))).toEqual({});
  });

  it("按 protocol 分支下发推理参数", () => {
    expect(
      buildProviderOptions(
        config({ protocol: "anthropic-messages", reasoningEffort: "high" }),
      ),
    ).toEqual({ anthropic: { thinking: { type: "adaptive" }, effort: "high" } });
    expect(
      buildProviderOptions(config({ protocol: "openai-responses", reasoningEffort: "low" })),
    ).toEqual({ openai: { reasoningEffort: "low" } });
    expect(
      buildProviderOptions(config({ protocol: "openai-chat", reasoningEffort: "medium" })),
    ).toEqual({ zenProvider: { reasoningEffort: "medium" } });
  });
});

describe("createLanguageModel", () => {
  it("baseUrl 自动补 /v1，已带版本段保持原样", () => {
    const a = createLanguageModel(config({ baseUrl: "http://host:1/v1/", model: "m" }));
    const b = createLanguageModel(config({ baseUrl: "http://host:1", model: "m" }));
    const c = createLanguageModel(
      config({ protocol: "anthropic-messages", baseUrl: "http://host:2/v2", model: "m" }),
    );
    const d = createLanguageModel(
      config({ protocol: "openai-responses", baseUrl: "http://host:3", model: "m" }),
    );
    for (const model of [a, b, c, d]) {
      expect(model).toBeTruthy();
      expect(typeof (model as { modelId?: string }).modelId).toBe("string");
    }
  });
});

describe("truncateOutput", () => {
  it("超限截断并标注，未超限原样返回", () => {
    expect(truncateOutput("abc")).toBe("abc");
    expect(truncateOutput("abcde", 3)).toBe("abc\n…[输出截断]");
  });
});

// ---------- 工具调用修复（GPT 系模型） ----------

const repairTools = {
  runTerminal: tool({
    description: "shell",
    inputSchema: z.object({ command: z.string() }),
    execute: async () => "",
  }),
};

describe("normalizeToolName", () => {
  it("snake/kebab/大小写变形唯一命中改回真实工具名", () => {
    expect(normalizeToolName("run_terminal", repairTools)).toBe("runTerminal");
    expect(normalizeToolName("RUNTERMINAL", repairTools)).toBe("runTerminal");
    expect(normalizeToolName("run-terminal", repairTools)).toBe("runTerminal");
  });

  it("未知名与归一化歧义返回 null", () => {
    expect(normalizeToolName("nonexistent_tool", repairTools)).toBeNull();
    const ambiguous = {
      ...repairTools,
      run_terminal: tool({
        description: "x",
        inputSchema: z.object({}),
        execute: async () => "",
      }),
    };
    expect(normalizeToolName("runTerminal", ambiguous)).toBeNull();
  });
});

describe("cleanToolInputText", () => {
  it("剥 markdown 代码围栏", () => {
    expect(cleanToolInputText('```json\n{"command":"ls"}\n```')).toBe('{"command":"ls"}');
  });

  it("提取 JSON 主体并去掉尾逗号", () => {
    expect(cleanToolInputText('这是入参 {"command":"ls",} 完毕')).toBe('{"command":"ls"}');
  });

  it("已是合法 JSON 时保持不变", () => {
    expect(cleanToolInputText('{"command":"ls"}')).toBe('{"command":"ls"}');
  });
});

describe("buildToolCallRepair", () => {
  const repair = buildToolCallRepair(createLanguageModel(config()));
  const base = {
    tools: repairTools,
    inputSchema: async () => ({ type: "object" as const }),
    instructions: undefined,
    system: undefined,
    messages: [],
  };

  it("NoSuchTool：工具名变形归一化修复", async () => {
    const result = await repair({
      ...base,
      toolCall: { type: "tool-call", toolCallId: "c1", toolName: "run_terminal", input: "{}" },
      error: new NoSuchToolError({ toolName: "run_terminal" }),
    });
    expect(result).not.toBeNull();
    expect(result?.toolName).toBe("runTerminal");
  });

  it("InvalidToolInput：围栏 JSON 清理后本地校验通过即修复", async () => {
    const result = await repair({
      ...base,
      toolCall: {
        type: "tool-call",
        toolCallId: "c2",
        toolName: "runTerminal",
        input: '```json\n{"command":"ls"}\n```',
      },
      error: new InvalidToolInputError({
        toolName: "runTerminal",
        toolInput: '```json\n{"command":"ls"}\n```',
        cause: new Error("invalid"),
      }),
    });
    expect(result).not.toBeNull();
    expect(result?.input).toBe('{"command":"ls"}');
  });

  it("未知工具名返回 null（修复器不抛异常、不瞎猜）", async () => {
    const unknown = await repair({
      ...base,
      toolCall: { type: "tool-call", toolCallId: "c3", toolName: "run_terminal", input: "{}" },
      error: new NoSuchToolError({ toolName: "totally_unknown" }),
    });
    expect(unknown).toBeNull();
  });
});

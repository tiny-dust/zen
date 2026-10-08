import { describe, expect, it } from "vitest";

import { buildProviderOptions, createLanguageModel, truncateOutput } from "./agent-model";

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

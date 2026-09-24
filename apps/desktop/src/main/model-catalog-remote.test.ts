import { describe, expect, it } from "vitest";

import { mapRemoteCatalog } from "./model-catalog-remote";

describe("mapRemoteCatalog", () => {
  const sample = {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-5-chat": {
          id: "gpt-5-chat",
          name: "GPT-5 Chat",
          reasoning: false,
          tool_call: true,
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 400000, output: 128000 },
        },
        "gpt-4-old": {
          id: "gpt-4-old",
          name: "GPT-4 Old",
          status: "deprecated",
          tool_call: true,
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 128000, output: 4096 },
        },
        "text-embedding-3-small": {
          id: "text-embedding-3-small",
          name: "text-embedding-3-small",
          modalities: { input: ["text"], output: [] },
          limit: { context: 8191, output: 0 },
        },
        "gpt-image-1": {
          id: "gpt-image-1",
          name: "GPT Image 1",
          modalities: { input: ["text", "image"], output: ["image"] },
          limit: { context: 0, output: 0 },
        },
        "bad-entry": { id: "", name: "no id" },
      },
    },
    "not-a-known-vendor": {
      id: "not-a-known-vendor",
      models: {
        "whatever": {
          id: "whatever",
          name: "Whatever",
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    },
    xiaomi: {
      id: "xiaomi",
      models: {
        "mimo-v2-flash": {
          id: "mimo-v2-flash",
          name: "MiMo V2 Flash",
          reasoning: true,
          tool_call: true,
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 262144, output: 65536 },
        },
      },
    },
  };

  it("映射内置厂商并填充上下文与能力", () => {
    const models = mapRemoteCatalog(sample);
    const gpt = models.find((m) => m.modelKey === "gpt-5-chat");
    expect(gpt).toBeDefined();
    expect(gpt?.vendor).toBe("openai");
    expect(gpt?.capabilities.contextWindow).toBe(400000);
    expect(gpt?.capabilities.maxOutputTokens).toBe(128000);
    expect(gpt?.capabilities.vision).toBe(true);
    expect(gpt?.capabilities.toolCall).toBe(true);
    expect(gpt?.capabilities.reasoning).toBeUndefined();
    expect(gpt?.capabilities.source).toBe("catalog");

    const mimo = models.find((m) => m.modelKey === "mimo-v2-flash");
    expect(mimo?.vendor).toBe("mimo");
    expect(mimo?.capabilities.reasoning).toBe(true);
  });

  it("过滤下架、非对话与未知厂商条目", () => {
    const models = mapRemoteCatalog(sample);
    const keys = models.map((m) => m.modelKey);
    expect(keys).not.toContain("gpt-4-old");
    expect(keys).not.toContain("text-embedding-3-small");
    expect(keys).not.toContain("gpt-image-1");
    expect(keys).not.toContain("whatever");
    expect(keys).not.toContain("bad-entry");
  });

  it("非法响应返回空数组", () => {
    expect(mapRemoteCatalog(null)).toEqual([]);
    expect(mapRemoteCatalog([1, 2])).toEqual([]);
    expect(mapRemoteCatalog("nope")).toEqual([]);
  });
});

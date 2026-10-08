import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRemoteCatalogModels, mapRemoteCatalog } from "./model-catalog-remote";

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

describe("mapRemoteCatalog 边角", () => {
  it("音频/视频输入 → media；字符串数字 limit 也接受；name 缺省回退 id", () => {
    const models = mapRemoteCatalog({
      anthropic: {
        id: "anthropic",
        models: {
          audio: {
            id: "audio-model",
            modalities: { input: ["text", "audio"], output: ["text"] },
            limit: { context: "200000", output: "8192" },
          },
          video: {
            id: "video-model",
            name: "  ",
            modalities: { input: ["video", "TEXT"], output: ["Text"] },
            limit: { context: -5, output: 0 },
          },
        },
      },
    });
    const audio = models.find((m) => m.modelKey === "audio-model");
    expect(audio?.capabilities.media).toBe(true);
    expect(audio?.capabilities.contextWindow).toBe(200000);
    expect(audio?.capabilities.maxOutputTokens).toBe(8192);

    const video = models.find((m) => m.modelKey === "video-model");
    // 大小写归一后仍算 text 进 text 出
    expect(video).toBeDefined();
    expect(video?.name).toBe("video-model");
    expect(video?.capabilities.media).toBe(true);
    expect(video?.capabilities.contextWindow).toBeUndefined();
    expect(video?.capabilities.maxOutputTokens).toBeUndefined();
  });

  it("同键去重：优先进 reasoning 标记的条目", () => {
    const models = mapRemoteCatalog({
      openai: {
        id: "openai",
        models: {
          a: {
            id: "same",
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 1, output: 1 },
          },
          b: {
            id: "same",
            reasoning: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 2, output: 2 },
          },
        },
      },
    });
    const deduped = models.filter((m) => m.modelKey === "same");
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.capabilities.reasoning).toBe(true);
    expect(deduped[0]?.capabilities.contextWindow).toBe(2);
  });

  it("provider.models 缺失/非对象 → 不产出条目", () => {
    expect(mapRemoteCatalog({ openai: { id: "openai" } })).toEqual([]);
    expect(mapRemoteCatalog({ openai: "str" })).toEqual([]);
  });
});

describe("fetchRemoteCatalogModels", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(response: Partial<Response> & { jsonBody?: unknown }): void {
    globalThis.fetch = vi.fn(async () => ({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.jsonBody,
    })) as unknown as typeof fetch;
  }

  it("成功拉取 → 映射 models + fetchedAt", async () => {
    stubFetch({
      jsonBody: {
        openai: {
          id: "openai",
          models: {
            gpt: {
              id: "gpt",
              modalities: { input: ["text"], output: ["text"] },
            },
          },
        },
      },
    });
    const result = await fetchRemoteCatalogModels();
    expect(result.models.map((m) => m.modelKey)).toEqual(["gpt"]);
    expect(typeof result.fetchedAt).toBe("number");
  });

  it("HTTP 错误 → 报状态码；数据为空 → 报空源", async () => {
    stubFetch({ ok: false, status: 503 });
    await expect(fetchRemoteCatalogModels()).rejects.toThrow("HTTP 503");

    stubFetch({ jsonBody: { unknown: {} } });
    await expect(fetchRemoteCatalogModels()).rejects.toThrow("数据源返回为空");
  });

  it("网络异常/超时分别报网络异常/请求超时", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchRemoteCatalogModels()).rejects.toThrow("网络异常");

    globalThis.fetch = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as unknown as typeof fetch;
    await expect(fetchRemoteCatalogModels()).rejects.toThrow("请求超时");
  });
});

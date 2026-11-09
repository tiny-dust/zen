import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveChatGptCredentials } from "./chatgpt-auth";
import { chatGptRequestTarget, completeOnce, completeVisionOnce, fetchModelsFromProvider, mapChatGptModels } from "./model-api";
import { listProviders } from "./model-db";

import type { ProviderSummary } from "@zen/shared";

vi.mock("./model-catalog", () => ({ matchCatalogModel: () => ({ model: null }) }));
vi.mock("./chatgpt-auth", () => ({
  CODEX_API_BASE_URL: "https://chatgpt.com/backend-api/codex",
  CODEX_CLIENT_VERSION: "0.160.0",
  resolveChatGptCredentials: vi.fn(async () => ({ accessToken: "account-token" })),
}));
vi.mock("./model-db", () => ({
  CHATGPT_PROVIDER_BASE_URL: "https://api.openai.com/v1",
  getSelection: vi.fn(async () => ({ providerId: "codex", modelId: "gpt-6.1-sol" })),
  listProviders: vi.fn(async () => [provider]),
  loadProviderApiKey: vi.fn(async () => "sk-test"),
  loadProviderUserAgent: vi.fn(async () => null),
  normalizeBaseUrl: (url: string) => url.replace(/\/+$/, ""),
  resolveAnthropicModelsUrl: (url: string) => `${url}/models`,
  resolveOpenAiModelsUrl: (url: string) => `${url}/models`,
  sanitizeUserAgent: (value: string | null | undefined) => value ?? null,
}));

const provider: ProviderSummary = {
  id: "codex",
  name: "Codex",
  protocol: "openai-responses",
  baseUrl: "https://chatgpt.com/backend-api/codex",
  authMode: "chatgpt-oauth",
  enabled: true,
  hasApiKey: false,
  apiKeyMask: "••••",
  models: [{ id: "gpt-6.1-sol", name: "GPT 6.1 Sol", enabled: true }],
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Codex model configuration", () => {
  it("uses the signed-in account catalog and keeps only listed models", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      models: [
        { slug: "gpt-6.1-sol", display_name: "GPT 6.1 Sol", visibility: "list" },
        { slug: "internal", display_name: "Internal", visibility: "hidden" },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchModelsFromProvider(provider);

    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer account-token" }),
    }));
    expect(result.models.map((model) => model.id)).toEqual(["gpt-6.1-sol"]);
    expect(result.models[0]?.name).toBe("GPT 6.1 Sol");
    expect(result.models[0]?.capabilities?.vision).toBeUndefined();
    expect(result.models[0]?.capabilities?.reasoning).toBe(true);
  });

  it("uses the Codex backend for the account catalog and requests", async () => {
    vi.mocked(resolveChatGptCredentials).mockResolvedValueOnce({
      accessToken: "codex-token",
      accountId: "acct-1",
      profile: "codex",
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      models: [{ slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchModelsFromProvider(provider);
    expect(result.models.map((model) => model.id)).toEqual(["gpt-5.6-sol"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent("0.160.0")}`);
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer codex-token",
      "ChatGPT-Account-ID": "acct-1",
      originator: "codex_cli_rs",
    });
  });

  it("posts Codex completions to the Codex responses endpoint with the account header", async () => {
    vi.mocked(resolveChatGptCredentials).mockResolvedValueOnce({
      accessToken: "codex-token",
      accountId: "acct-1",
      profile: "codex",
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response([
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      'data: {"type":"response.completed"}',
      '',
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await completeOnce("Say hello")).toBe("Hello");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer codex-token",
      "ChatGPT-Account-ID": "acct-1",
      originator: "codex_cli_rs",
    });
  });

  it("rejects a non-account model catalog shape", () => {
    expect(() => mapChatGptModels({ data: [{ id: "gpt-6.1-sol" }] })).toThrow("格式无效");
  });

  it("sends a completed streaming Responses request to the public endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response([
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      'data: {"type":"response.output_text.delta","delta":" Codex"}',
      'data: {"type":"response.completed"}',
      '',
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await completeOnce("Say hello", { system: "Be concise" })).toBe("Hello Codex");
    const [url, init] = fetchMock.mock.calls[0]!;
    if (!init) throw new Error("missing request options");
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers).toMatchObject({ Authorization: "Bearer account-token" });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "gpt-6.1-sol", input: [{ role: "user", content: "Say hello" }],
      instructions: "Be concise", store: false, stream: true,
    });
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body).not.toHaveProperty("messages");
  });

  it("treats an interrupted stream as an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    )));
    await expect(completeOnce("Say hello")).rejects.toThrow("未收到完成事件");
  });

  it("parses SSE events split across network chunks", async () => {
    const bytes = Buffer.from(
      'data: {"type":"response.output_text.delta","delta":"你好"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 3) {
          controller.enqueue(bytes.subarray(offset, offset + 3));
        }
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    expect(await completeOnce("Say hello")).toBe("你好");
  });

  it("sends image analysis through the same plan-compatible Responses route", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      'data: {"type":"response.output_text.delta","delta":"a diagram"}\n\ndata: {"type":"response.completed"}\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    expect(await completeVisionOnce([{ name: "x.png", mediaType: "image/png", base64: "YWJj" }], "Describe"))
      .toBe("a diagram");
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("missing request options");
    const body = JSON.parse(init.body as string);
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "Describe" },
      { type: "input_image", image_url: "data:image/png;base64,YWJj" },
    ]);
    expect(body).not.toHaveProperty("max_output_tokens");
  });

  it("supports Codex models with a regular OpenAI API key", async () => {
    vi.mocked(listProviders).mockResolvedValueOnce([{ ...provider, authMode: "api-key", hasApiKey: true,
      baseUrl: "https://api.openai.com/v1" }]);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      'data: {"type":"response.output_text.delta","delta":"key works"}\n\ndata: {"type":"response.completed"}\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    expect(await completeOnce("Test", { maxTokens: 123 })).toBe("key works");
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("missing request options");
    expect(init.headers).toMatchObject({ Authorization: "Bearer sk-test" });
    expect(JSON.parse(init.body as string)).toMatchObject({ max_output_tokens: 4096, store: false, stream: true });
  });
});

describe("chatGptRequestTarget", () => {
  it("Codex 账号走 ChatGPT 后端并带账号请求头", () => {
    expect(chatGptRequestTarget({ profile: "codex", accountId: "acct-1" })).toEqual({
      baseUrl: "https://chatgpt.com/backend-api/codex",
      headers: { originator: "codex_cli_rs", "ChatGPT-Account-ID": "acct-1" },
    });
  });

  it("Zen 自注册账号走公开 API，不带额外请求头", () => {
    expect(chatGptRequestTarget({ profile: "zen" })).toEqual({
      baseUrl: "https://api.openai.com/v1",
      headers: {},
    });
  });
});

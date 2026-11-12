import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PetGenerateInput, ProviderSummary } from "@zen/shared";
import { generatePetSprite } from "./pet-image";
import { listProviders, loadProviderApiKey } from "./model-db";
import { nativeImage } from "electron";

vi.mock("./model-db", () => ({
  listProviders: vi.fn(),
  loadProviderApiKey: vi.fn(),
  normalizeBaseUrl: (url: string) => url.trim().replace(/\/+$/, ""),
}));
vi.mock("electron", () => ({
  nativeImage: { createFromBuffer: vi.fn(() => ({ isEmpty: () => false, getSize: () => ({ width: 1024, height: 1024 }) })) },
}));

const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const input: PetGenerateInput = {
  providerId: "provider-1", modelId: "image-model", sourceDataUrl: `data:image/png;base64,${png.toString("base64")}`, style: "Soft watercolor",
};
const provider: ProviderSummary = {
  id: "provider-1", name: "Image Provider", protocol: "openai-chat", baseUrl: "https://images.example/v1/",
  enabled: true, authMode: "api-key", hasApiKey: true, apiKeyMask: "••••",
  models: [{ id: "image-model", name: "Image Model", enabled: true, capabilities: { imageEdit: true } }],
  createdAt: 1, updatedAt: 1,
};

beforeEach(() => {
  vi.mocked(listProviders).mockResolvedValue([provider]);
  vi.mocked(loadProviderApiKey).mockResolvedValue("secret-api-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function stubSuccess() {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("generatePetSprite", () => {
  it("edits the original image as a transparent 4x4 sprite and returns source and PNG", async () => {
    const fetchMock = stubSuccess();
    const result = await generatePetSprite(input);
    expect(result).toEqual({ source: png, sprite: png });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    if (!init) throw new Error("missing request options");
    expect(url).toBe("https://images.example/v1/images/edits");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer secret-api-key" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("model")).toBe("image-model");
    expect(form.get("background")).toBe("transparent");
    expect(form.get("output_format")).toBe("png");
    expect(form.get("size")).toBe("1024x1024");
    const image = form.get("image[]") as File;
    expect(image.type).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    const prompt = String(form.get("prompt"));
    expect(prompt).toContain("Soft watercolor");
    expect(prompt).toMatch(/original.*(subject|silhouette|outline)/i);
    expect(prompt).toMatch(/transparent/i);
    expect(prompt).toMatch(/4x4.*16/i);
    for (const state of ["idle", "working", "done", "error"]) expect(prompt).toContain(state);
    expect(prompt).toMatch(/four frames|4 frames/i);
    expect(prompt).toMatch(/no text/i);
    expect(prompt).toMatch(/no borders/i);
  });

  it.each([
    ["image/gif", "Z2lm"], ["image/png", "!!!!"],
  ])("rejects unsupported or malformed %s image data", async (mime, data) => {
    await expect(generatePetSprite({ ...input, sourceDataUrl: `data:${mime};base64,${data}` })).rejects.toThrow();
    expect(listProviders).not.toHaveBeenCalled();
  });

  it("rejects source image bytes that disagree with the declared MIME", async () => {
    await expect(generatePetSprite({ ...input, sourceDataUrl: `data:image/jpeg;base64,${png.toString("base64")}` })).rejects.toThrow(/格式不符/);
    expect(listProviders).not.toHaveBeenCalled();
  });

  it.each([
    ["image/jpeg", Buffer.from("ffd8ff00", "hex")],
    ["image/webp", Buffer.from("RIFF0000WEBP")],
  ])("accepts a %s source", async (mime, bytes) => {
    stubSuccess();
    expect((await generatePetSprite({ ...input, sourceDataUrl: `data:${mime};base64,${bytes.toString("base64")}` })).source).toEqual(bytes);
  });

  it("rejects images above 10 MB and invalid styles before fetching", async () => {
    const tooLarge = `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")}`;
    await expect(generatePetSprite({ ...input, sourceDataUrl: tooLarge })).rejects.toThrow(/10 MB/);
    await expect(generatePetSprite({ ...input, style: "  " })).rejects.toThrow();
    await expect(generatePetSprite({ ...input, style: "a".repeat(501) })).rejects.toThrow(/500/);
    expect(listProviders).not.toHaveBeenCalled();
  });

  it.each([
    [{ enabled: false }, "供应商"],
    [{ authMode: "chatgpt-oauth" }, "API Key"],
    [{ hasApiKey: false }, "API Key"],
    [{ protocol: "anthropic-messages" }, "协议"],
    [{ models: [{ ...provider.models[0], enabled: false }] }, "模型"],
    [{ models: [{ ...provider.models[0], capabilities: { vision: true } }] }, "图片编辑"],
  ] as const)("refuses an ineligible provider/model: %j", async (patch, reason) => {
    vi.mocked(listProviders).mockResolvedValueOnce([{ ...provider, ...patch } as ProviderSummary]);
    await expect(generatePetSprite(input)).rejects.toThrow(reason);
    expect(loadProviderApiKey).not.toHaveBeenCalled();
  });

  it("refuses an unknown provider and an unknown model", async () => {
    await expect(generatePetSprite({ ...input, providerId: "missing" })).rejects.toThrow(/供应商/);
    await expect(generatePetSprite({ ...input, modelId: "missing" })).rejects.toThrow(/模型/);
  });

  it("uses /v1/images/edits for an unversioned base URL", async () => {
    vi.mocked(listProviders).mockResolvedValueOnce([{ ...provider, baseUrl: "https://images.example/" }]);
    const fetchMock = stubSuccess();
    await generatePetSprite(input);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://images.example/v1/images/edits");
  });

  it("reports provider errors without echoing credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "quota exhausted secret-api-key" } }), { status: 429 })));
    await expect(generatePetSprite(input)).rejects.toThrow(/quota exhausted/);
    await expect(generatePetSprite(input)).rejects.not.toThrow(/secret-api-key/);
  });

  it.each(["{}", JSON.stringify({ data: [{ b64_json: "not-base64" }] }), JSON.stringify({ data: [{ b64_json: Buffer.from("not a png").toString("base64") }] })])("rejects malformed provider output", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    await expect(generatePetSprite(input)).rejects.toThrow();
  });

  it("rejects a non-square PNG sprite", async () => {
    vi.mocked(nativeImage.createFromBuffer).mockReturnValueOnce({
      isEmpty: () => false, getSize: () => ({ width: 1024, height: 512 }),
    } as ReturnType<typeof nativeImage.createFromBuffer>);
    stubSuccess();
    await expect(generatePetSprite(input)).rejects.toThrow(/正方形/);
  });

  it("rejects a decoded sprite above 20 MB", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.concat([png, Buffer.alloc(20 * 1024 * 1024)]).toString("base64") }] }), { status: 200 })));
    await expect(generatePetSprite(input)).rejects.toThrow(/20 MB/);
  });
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderSummary } from "@zen/shared";

import { listProviders, loadProviderApiKey } from "./model-db";
import { cancelImageGeneration, deleteImage, generateImage, listImages, readImageDataUrl } from "./image-library";

let imagesDir = "";

vi.mock("./model-db", () => ({
  listProviders: vi.fn(),
  loadProviderApiKey: vi.fn(),
  normalizeBaseUrl: (url: string) => url.trim().replace(/\/+$/, ""),
}));
vi.mock("./zen-dir", () => ({ zenImagesDir: () => imagesDir }));
vi.mock("electron", () => ({
  nativeImage: {
    createFromBuffer: vi.fn(() => ({ isEmpty: () => false, getSize: () => ({ width: 1024, height: 1024 }) })),
  },
}));

const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const provider: ProviderSummary = {
  id: "provider-1",
  name: "Image Provider",
  protocol: "openai-chat",
  baseUrl: "https://images.example/v1/",
  enabled: true,
  authMode: "api-key",
  hasApiKey: true,
  apiKeyMask: "••••",
  models: [{ id: "image-model", name: "Image Model", enabled: true, capabilities: { imageEdit: true } }],
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(async () => {
  imagesDir = await mkdtemp(join(tmpdir(), "zen-images-"));
  vi.mocked(listProviders).mockResolvedValue([provider]);
  vi.mocked(loadProviderApiKey).mockResolvedValue("secret-api-key");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await rm(imagesDir, { recursive: true, force: true });
});

function stubGeneration(body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
}

const input = { providerId: "provider-1", modelId: "image-model", prompt: "一只在写代码的猫" };

describe("generateImage", () => {
  it("生成成功：落盘图片与元数据，素材库可列出，并能读成 data URL", async () => {
    const fetchMock = stubGeneration({ data: [{ b64_json: png.toString("base64") }] });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage({ ...input, size: "1024x1536" });
    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toMatch(/^img-[a-z0-9]+-[0-9a-f]{8}$/);
    expect(record.fileName).toBe(`${record.id}.png`);
    expect(Buffer.from(await readFile(record.path))).toEqual(png);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://images.example/v1/images/generations");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "image-model",
      prompt: input.prompt,
      size: "1024x1536",
      n: 1,
      response_format: "b64_json",
    });

    expect((await listImages()).map((item) => item.id)).toEqual([record.id]);
    const read = await readImageDataUrl(record.id);
    expect(read.ok).toBe(true);
    expect(read.dataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
  });

  it("非法尺寸回退 1024x1024，而不是把任意字符串发给供应商", async () => {
    const fetchMock = stubGeneration({ data: [{ b64_json: png.toString("base64") }] });
    vi.stubGlobal("fetch", fetchMock);
    await generateImage({ ...input, size: "999x999" as never });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).size).toBe("1024x1024");
  });

  it.each([[""], ["   "]])("空描述在发请求前就被拒绝（%j）", async (prompt) => {
    const fetchMock = stubGeneration({});
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateImage({ ...input, prompt });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("超过 2000 字的描述被拒绝", async () => {
    const result = await generateImage({ ...input, prompt: "a".repeat(2001) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/2000/);
  });

  it("模型未开启 imageEdit 能力时拒绝，且不发起请求", async () => {
    vi.mocked(listProviders).mockResolvedValueOnce([
      { ...provider, models: [{ ...provider.models[0]!, capabilities: { vision: true } }] },
    ]);
    const fetchMock = stubGeneration({});
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateImage(input);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/模型不支持图片生成/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("供应商报错回显但不泄露 API Key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "quota secret-api-key" } }), { status: 429 })));
    const result = await generateImage(input);
    expect(result.error).toMatch(/quota/);
    expect(result.error).not.toMatch(/secret-api-key/);
  });

  it("只返回图片链接时明确说明，不静默失败", async () => {
    vi.stubGlobal("fetch", stubGeneration({ data: [{ url: "https://cdn.example/a.png" }] }));
    const result = await generateImage(input);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/b64_json/);
  });

  it("非图片数据被拒绝", async () => {
    vi.stubGlobal("fetch", stubGeneration({ data: [{ b64_json: Buffer.from("not a png").toString("base64") }] }));
    const result = await generateImage(input);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/格式不受支持/);
  });

  it("用户取消时返回「已取消生成」，不落盘", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = generateImage(input);
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelImageGeneration();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/已取消/);
    expect(await listImages()).toEqual([]);
  });
});

describe("素材库", () => {
  it("损坏的元数据与丢失的图片文件都不进清单", async () => {
    await writeFile(join(imagesDir, "img-abc-def12345.json"), "{not json", "utf8");
    const missing = {
      id: "img-abc-12345678",
      prompt: "p",
      providerId: "provider-1",
      modelId: "image-model",
      width: 1,
      height: 1,
      sizeBytes: 1,
      createdAt: 1,
      path: join(imagesDir, "img-abc-12345678.png"),
      fileName: "img-abc-12345678.png",
    };
    await writeFile(join(imagesDir, "img-abc-12345678.json"), JSON.stringify(missing), "utf8");
    expect(await listImages()).toEqual([]);
  });

  it("删除同时移除图片与元数据，重复删除报「素材不存在」", async () => {
    vi.stubGlobal("fetch", stubGeneration({ data: [{ b64_json: png.toString("base64") }] }));
    const record = (await generateImage(input)).record!;

    expect(await deleteImage(record.id)).toEqual({ ok: true });
    expect(await listImages()).toEqual([]);
    expect(await readImageDataUrl(record.id)).toMatchObject({ ok: false, error: "素材不存在" });
    expect(await deleteImage(record.id)).toMatchObject({ ok: false, error: "素材不存在" });
  });

  it("非法素材 id 被拒绝（不接受路径片段）", async () => {
    for (const id of ["../../etc/passwd", "img-x", "IMG-1-2"]) {
      expect((await readImageDataUrl(id)).ok).toBe(false);
      expect((await deleteImage(id)).ok).toBe(false);
    }
  });
});

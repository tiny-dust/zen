import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOCAL_IMAGE_MARKER } from "@/components/ai-elements/response/local-file-links";
import {
  cachedLocalImage,
  ensureLocalImage,
} from "@/components/ai-elements/response/local-image-cache";

const previewFile = vi.fn(async () => null as unknown);

vi.mock("@/stores/chat", () => ({
  useChatStore: () => ({ sessionWorkspaceId: "ws1" }),
}));

vi.mock("@/stores/workspace", () => ({
  useWorkspaceStore: () => ({
    pathOf: (id: string) => (id === "ws1" ? "/w/root" : undefined),
  }),
}));

function marker(rawRef: string): string {
  return `${LOCAL_IMAGE_MARKER}${encodeURIComponent(rawRef)}`;
}

beforeEach(() => {
  setActivePinia(createPinia());
  previewFile.mockClear();
  vi.stubGlobal("zen", { workspace: { previewFile } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureLocalImage", () => {
  it("首次调用占位为 null，取回后命中 data URL", async () => {
    previewFile.mockResolvedValueOnce({ kind: "image", dataUrl: "data:image/png;base64,AAA" });
    expect(ensureLocalImage("/img/a.png", "/w/root")).toBeNull();
    expect(previewFile).toHaveBeenCalledWith("/w/root", "/img/a.png");
    await Promise.resolve();
    await Promise.resolve();
    // 幂等：命中缓存不再发起加载
    expect(ensureLocalImage("/img/a.png", "/w/root")).toBe("data:image/png;base64,AAA");
    expect(previewFile).toHaveBeenCalledTimes(1);
  });

  it("非图片预览与加载失败都缓存为 null", async () => {
    previewFile.mockResolvedValueOnce({ kind: "text", text: "nope" });
    previewFile.mockRejectedValueOnce(new Error("io"));
    expect(ensureLocalImage("/img/not-image.png", "/w/root")).toBeNull();
    expect(ensureLocalImage("/img/broken.png", "/w/root")).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(ensureLocalImage("/img/not-image.png", "/w/root")).toBeNull();
    expect(ensureLocalImage("/img/broken.png", "/w/root")).toBeNull();
    expect(previewFile).toHaveBeenCalledTimes(2);
  });

  it("缓存 key 含工作区：同一引用不同 cwd 分开加载", async () => {
    previewFile.mockResolvedValue({ kind: "image", dataUrl: "data:image/png;base64,BBB" });
    ensureLocalImage("/img/c.png", "/w/one");
    ensureLocalImage("/img/c.png", "/w/two");
    expect(previewFile).toHaveBeenCalledWith("/w/one", "/img/c.png");
    expect(previewFile).toHaveBeenCalledWith("/w/two", "/img/c.png");
    await Promise.resolve();
    await Promise.resolve();
    expect(ensureLocalImage("/img/c.png", "/w/one")).toBe("data:image/png;base64,BBB");
  });

  it("window.zen 缺失时不抛错，缓存占位 null", () => {
    vi.unstubAllGlobals();
    expect(ensureLocalImage("/img/d.png", "/w/root")).toBeNull();
    expect(ensureLocalImage("/img/d.png", "/w/root")).toBeNull();
    expect(previewFile).not.toHaveBeenCalled();
  });
});

describe("cachedLocalImage", () => {
  it("非标记 src 返回 null", () => {
    expect(cachedLocalImage(undefined)).toBeNull();
    expect(cachedLocalImage("https://a.com/x.png")).toBeNull();
    expect(cachedLocalImage("data:image/png;base64,XXX")).toBeNull();
  });

  it("解码标记并按当前会话工作区加载", async () => {
    previewFile.mockResolvedValueOnce({ kind: "image", dataUrl: "data:image/png;base64,CCC" });
    expect(cachedLocalImage(marker("/img/e.png"))).toBeNull();
    expect(previewFile).toHaveBeenCalledWith("/w/root", "/img/e.png");
    await Promise.resolve();
    await Promise.resolve();
    expect(cachedLocalImage(marker("/img/e.png"))).toBe("data:image/png;base64,CCC");
  });
});

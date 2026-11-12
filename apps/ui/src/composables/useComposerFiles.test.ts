import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia, storeToRefs } from "pinia";
import { createApp, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dedupeFileNames, useComposerFiles } from "@/composables/useComposerFiles";
import { useChatStore } from "@/stores/chat";
import type { ComposerAttachment } from "@/stores/chat-types";

function fileOf(name: string, type = "image/png"): File {
  return new File(["blob"], name, { type, lastModified: 1_728_000_000_000 });
}

describe("dedupeFileNames # 批内文件名去重", () => {
  it("同批 3 个 image.png：首个保持原名，后续取 image-2.png / image-3.png", () => {
    const renamed = dedupeFileNames([fileOf("image.png"), fileOf("image.png"), fileOf("image.png")]);
    expect(renamed.map((file) => file.name)).toEqual(["image.png", "image-2.png", "image-3.png"]);
  });

  it("不同名文件保持原对象与名称不变", () => {
    const a = fileOf("a.png");
    const b = fileOf("b.png");
    const renamed = dedupeFileNames([a, b]);
    expect(renamed.map((file) => file.name)).toEqual(["a.png", "b.png"]);
    expect(renamed[0]).toBe(a);
    expect(renamed[1]).toBe(b);
  });

  it("无扩展名文件自增：screenshot → screenshot-2", () => {
    const renamed = dedupeFileNames([fileOf("screenshot", "text/plain"), fileOf("screenshot", "text/plain")]);
    expect(renamed.map((file) => file.name)).toEqual(["screenshot", "screenshot-2"]);
  });

  it("隐藏文件（.gitignore）整体作 base：.gitignore-2", () => {
    const renamed = dedupeFileNames([fileOf(".gitignore", "text/plain"), fileOf(".gitignore", "text/plain")]);
    expect(renamed.map((file) => file.name)).toEqual([".gitignore", ".gitignore-2"]);
  });

  it("序号与批内既有名冲突时顺延：image.png + image-2.png + image.png → image.png / image-2.png / image-3.png", () => {
    const renamed = dedupeFileNames([fileOf("image.png"), fileOf("image-2.png"), fileOf("image.png")]);
    expect(renamed.map((file) => file.name)).toEqual(["image.png", "image-2.png", "image-3.png"]);
  });

  it("重命名保留 type 与 lastModified，内容可读", async () => {
    const renamed = dedupeFileNames([fileOf("image.png"), fileOf("image.png")]);
    expect(renamed[1].name).toBe("image-2.png");
    expect(renamed[1].type).toBe("image/png");
    expect(renamed[1].lastModified).toBe(1_728_000_000_000);
    await expect(renamed[1].text()).resolves.toBe("blob");
  });

  it("空文件名跳过，不参与改名", () => {
    const empty = new File(["blob"], "");
    const renamed = dedupeFileNames([empty, fileOf("image.png"), fileOf("image.png")]);
    expect(renamed.map((file) => file.name)).toEqual(["", "image.png", "image-2.png"]);
  });
});

const apps: ReturnType<typeof createApp>[] = [];
const previewFile = vi.fn();
const createObjectURL = vi.fn(() => "blob:test-image");
const revokeObjectURL = vi.fn();

function mountFiles(initial: ComposerAttachment[] = []) {
  const attachments = storeToRefs(useChatStore()).attachments;
  attachments.value = initial;
  let files: ReturnType<typeof useComposerFiles> | undefined;
  const app = createApp({
    setup() {
      files = useComposerFiles({ attachments, insertAtCaret: vi.fn(), insertAtPoint: vi.fn(() => false) });
      return () => null;
    },
  });
  app.mount(document.createElement("div"));
  apps.push(app);
  if (!files) throw new Error("useComposerFiles did not mount");
  return { files, attachments, app };
}

function pathAttachment(name = "photo.png", path = "/cache/photo.png"): ComposerAttachment {
  return { id: "image-1", name, path, size: 0, isImage: true };
}

beforeEach(() => {
  setActivePinia(createPinia());
  previewFile.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal("zen", { workspace: { previewFile }, pathForFile: () => "/cache/photo.png" });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  vi.unstubAllGlobals();
});

describe("useComposerFiles 草稿图片预览", () => {
  it("恢复路径图片时读取 data URL 和实际大小，移除时不 revoke data URL", async () => {
    previewFile.mockResolvedValue({ kind: "image", dataUrl: "data:image/png;base64,AA==", size: 512 });
    const { files, attachments } = mountFiles([pathAttachment()]);
    await flushPromises();

    expect(previewFile).toHaveBeenCalledExactlyOnceWith(undefined, "/cache/photo.png");
    expect(files.imageUrls.value.get("image-1")).toBe("data:image/png;base64,AA==");
    expect(attachments.value[0].size).toBe(512);
    attachments.value = [];
    await nextTick();
    expect(files.imageUrls.value.has("image-1")).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("路径图片移除后异步返回不会复活预览或修改新草稿", async () => {
    let resolvePreview: (value: { kind: "image"; dataUrl: string; size: number }) => void = () => undefined;
    previewFile.mockImplementation(() => new Promise((resolve) => { resolvePreview = resolve; }));
    const { files, attachments } = mountFiles([pathAttachment()]);
    attachments.value = [];
    await nextTick();
    resolvePreview({ kind: "image", dataUrl: "data:image/png;base64,AA==", size: 512 });
    await flushPromises();

    expect(files.imageUrls.value.size).toBe(0);
    expect(attachments.value).toEqual([]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("非图片与无路径图片不发起预览请求", async () => {
    const text = { ...pathAttachment("readme.md", "/cache/readme.md"), id: "text-1", isImage: false, size: 23 };
    const { files } = mountFiles([text, pathAttachment("missing.png", "")]);
    await flushPromises();
    expect(previewFile).not.toHaveBeenCalled();
    expect(files.imageUrls.value.size).toBe(0);
  });

  it("普通 File 的 objectURL 优先于路径预览且只 revoke objectURL", async () => {
    previewFile.mockResolvedValue({ kind: "image", dataUrl: "data:image/png;base64,AA==", size: 512 });
    const { files, attachments } = mountFiles();
    const file = fileOf("photo.png");
    await files.onPaste({ clipboardData: { files: [file] }, preventDefault: vi.fn() } as unknown as ClipboardEvent);
    await flushPromises();
    const id = attachments.value[0].id;

    expect(files.imageUrls.value.get(id)).toBe("blob:test-image");
    expect(attachments.value[0].size).toBe(file.size);
    expect(previewFile).not.toHaveBeenCalled();
    attachments.value = [];
    await nextTick();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:test-image");
  });

  it("组件卸载后晚到的路径预览不会重新写入", async () => {
    let resolvePreview: (value: { kind: "image"; dataUrl: string; size: number }) => void = () => undefined;
    previewFile.mockImplementation(() => new Promise((resolve) => { resolvePreview = resolve; }));
    const { files, app } = mountFiles([pathAttachment()]);
    app.unmount();
    resolvePreview({ kind: "image", dataUrl: "data:image/png;base64,AA==", size: 512 });
    await flushPromises();
    expect(files.imageUrls.value.size).toBe(0);
  });
});
